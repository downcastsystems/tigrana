import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorStateConfig, type Selection } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { WritingStyle } from "../lib/writingStyle";
import type { NoteListFoldingMetadata } from "../types";

type FoldingState = {
  enabled: boolean;
  foldingEnabled: boolean;
  writingStyle: WritingStyle;
  initialized: boolean;
  saved?: NoteListFoldingMetadata | null;
  decorations: DecorationSet;
  collapsedCount: number;
};
type FoldingMeta = { writingStyle?: WritingStyle; foldingEnabled?: boolean; position?: number; collapsed?: boolean };
export type FoldingRestoreConfig = { writingStyle: WritingStyle; foldingEnabled?: boolean; saved?: NoteListFoldingMetadata | null };
export const listFoldingKey = new PluginKey<FoldingState>("listFolding");

function hasChildList(node: ProseMirrorNode) {
  if (node.type.name !== "listItem") return false;
  for (let index = 1; index < node.childCount; index++) {
    if (["bulletList", "orderedList", "taskList"].includes(node.child(index).type.name)) return true;
  }
  return false;
}

function setItemCollapsed(view: EditorView, position: number, collapsed: boolean) {
  const item = view.state.doc.nodeAt(position);
  if (!item || !hasChildList(item)) return;
  const tr = view.state.tr.setMeta(listFoldingKey, { position, collapsed }).setMeta("addToHistory", false);
  // Never leave an editing selection in children that are about to hide.
  const childStart = position + 1 + item.firstChild!.nodeSize;
  if (collapsed && tr.selection.to >= childStart && tr.selection.from < position + item.nodeSize - 1) {
    tr.setSelection(TextSelection.create(tr.doc, position + 2 + item.firstChild!.content.size));
  }
  view.dispatch(tr);
}

function itemDecorations(node: ProseMirrorNode, pos: number, collapsed: boolean) {
  if (!hasChildList(node)) return [];
  const summaryPosition = pos + node.firstChild!.nodeSize;
  const decorations = [
    Decoration.node(pos, pos + node.nodeSize, { "data-list-foldable": "true", "data-list-collapsed": String(collapsed) }, { foldedNode: node, collapsed, summaryOffset: collapsed ? node.firstChild!.nodeSize : undefined }),
    Decoration.widget(pos + 1, (view, getPos) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "list-fold-button";
      button.contentEditable = "false";
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute("aria-label", collapsed ? "Expand sub-bullets" : "Collapse sub-bullets");
      button.title = button.getAttribute("aria-label")!;
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", event => {
        event.preventDefault();
        const widgetPos = getPos();
        if (widgetPos === undefined) return;
        setItemCollapsed(view, widgetPos - 1, !collapsed);
      });
      return button;
    }, { key: `list-fold:${collapsed}`, side: -2, stopEvent: () => true }),
  ];
  if (collapsed) decorations.push(Decoration.widget(summaryPosition, (view, getPos) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "list-fold-summary-button";
    button.contentEditable = "false";
    button.textContent = "...";
    button.setAttribute("aria-label", "Expand sub-bullets");
    button.setAttribute("aria-expanded", "false");
    button.title = "Expand sub-bullets";
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", event => {
      event.preventDefault();
      const widgetPos = getPos();
      if (widgetPos !== undefined) setItemCollapsed(view, view.state.doc.resolve(widgetPos).before(-1), false);
    });
    return button;
  }, { key: "list-fold-summary", side: 1, marks: [], listFoldSummary: true, stopEvent: () => true }));
  return decorations;
}

function buildFoldingState(doc: ProseMirrorNode, restore?: FoldingRestoreConfig, selection?: Selection): FoldingState {
  const settings = { writingStyle: restore?.writingStyle ?? "notes", foldingEnabled: restore?.foldingEnabled ?? true };
  if (settings.writingStyle === "story" || !settings.foldingEnabled) return {
    ...settings, enabled: false, initialized: false, saved: restore?.saved, decorations: DecorationSet.empty, collapsedCount: 0,
  };
  const saved = restore?.saved?.docSize === doc.content.size ? restore.saved.collapsed : [];
  const byPosition = new Map(saved.map(range => [range[0], range]));
  const decorations: Decoration[] = [];
  let collapsedCount = 0;
  // Restore during the same traversal that creates the normal folding controls.
  doc.descendants((node, pos) => {
    if (!hasChildList(node)) return;
    const range = byPosition.get(pos);
    const childStart = pos + 1 + node.firstChild!.nodeSize;
    const containsSelection = selection && [selection.anchor, selection.head].some(endpoint => endpoint >= childStart && endpoint < pos + node.nodeSize - 1);
    const collapsed = range?.[1] === node.nodeSize && range[2] === node.firstChild!.nodeSize && !containsSelection;
    if (collapsed) collapsedCount++;
    decorations.push(...itemDecorations(node, pos, collapsed));
  });
  return { ...settings, enabled: true, initialized: true, decorations: DecorationSet.create(doc, decorations), collapsedCount };
}

/** Folding stays in plugin view state; persistence captures it only at idle/boundaries. */
export const ListFolding = Extension.create({
  name: "listFolding",
  addProseMirrorPlugins() {
    return [new Plugin<FoldingState>({
      key: listFoldingKey,
      state: {
        init: (config, state) => buildFoldingState(state.doc, (config as EditorStateConfig & { listFolding?: FoldingRestoreConfig }).listFolding, state.selection),
        apply(tr, previous) {
          const meta = tr.getMeta(listFoldingKey) as FoldingMeta | undefined;
          const settings = {
            writingStyle: meta?.writingStyle ?? previous.writingStyle,
            foldingEnabled: meta?.foldingEnabled ?? previous.foldingEnabled,
          };
          const enabled = settings.writingStyle === "notes" && settings.foldingEnabled;
          if (!enabled) {
            // Keep folds across a preference toggle if content stays unchanged.
            // Disabled typing does no decoration mapping or list traversal.
            if (tr.docChanged || settings.writingStyle === "story") return {
              ...settings, enabled, initialized: false, decorations: DecorationSet.empty, collapsedCount: 0,
            };
            if (!previous.enabled && settings.foldingEnabled === previous.foldingEnabled && settings.writingStyle === previous.writingStyle) return previous;
            return { ...previous, ...settings, enabled };
          }
          if (!previous.initialized) return buildFoldingState(tr.doc, { ...settings, saved: previous.saved }, tr.selection);
          if (previous.enabled && !tr.docChanged && !tr.selectionSet && meta?.position === undefined) return previous;

          let decorations = previous.decorations;
          let collapsedCount = previous.collapsedCount;
          const lostFolds = new Set<ProseMirrorNode>();
          // Map through intermediate documents, including list unwraps on undo.
          tr.mapping.maps.forEach((map, index) => {
            decorations = decorations.map(new Mapping([map]), tr.docs[index + 1] ?? tr.doc, {
              onRemove: spec => { if (spec.collapsed) { collapsedCount--; lostFolds.add(spec.foldedNode.firstChild); } },
            });
          });
          const positions = new Set<number>();
          tr.mapping.maps.forEach((map, index) => {
            const remaining = tr.mapping.slice(index + 1);
            map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
              const from = Math.max(0, remaining.map(newFrom, -1) - 1);
              const to = Math.min(tr.doc.content.size, remaining.map(newTo, 1) + 1);
              // Only changed items and their ancestors are inspected while typing.
              tr.doc.nodesBetween(from, to, (node, pos) => {
                if (node.type.name === "listItem") positions.add(pos);
              });
            });
          });
          const refreshed = new Set<number>();
          const inverseMapping = tr.mapping.invert();
          const removeItemDecorations = (pos: number) => {
            const old = decorations.find(pos, pos + 1).filter(decoration => decoration.from === pos || decoration.from === pos + 1);
            const summary = old.find(decoration => decoration.spec.summaryOffset !== undefined);
            if (summary) {
              // A split can move the old summary into a second paragraph. Remove
              // it at its mapped position without scanning all of the children.
              // Keep an offset: edits before an untouched item move its
              // decorations without rebuilding their specs.
              const summaryPos = refreshed.has(pos) ? pos + summary.spec.summaryOffset
                : tr.mapping.map(inverseMapping.map(pos, 1) + summary.spec.summaryOffset, 1);
              old.push(...decorations.find(summaryPos, summaryPos, spec => spec.listFoldSummary));
            }
            // DecorationSet.remove consumes its array while descending.
            const collapsed = old.some(decoration => decoration.spec.collapsed);
            if (collapsed) collapsedCount--;
            decorations = decorations.remove(old);
            refreshed.add(pos);
            return collapsed;
          };
          for (const pos of positions) {
            const node = tr.doc.nodeAt(pos)!;
            const wasCollapsed = removeItemDecorations(pos);
            // Sorting rebuilds containers but keeps their paragraph identities.
            const collapsed = wasCollapsed || (node.firstChild !== null && lostFolds.has(node.firstChild));
            decorations = decorations.add(tr.doc, itemDecorations(node, pos, collapsed));
            if (collapsed && hasChildList(node)) collapsedCount++;
          }

          const setCollapsed = (pos: number, collapsed: boolean) => {
            const node = tr.doc.nodeAt(pos);
            if (!node || !hasChildList(node)) return;
            removeItemDecorations(pos);
            decorations = decorations.add(tr.doc, itemDecorations(node, pos, collapsed));
            if (collapsed) collapsedCount++;
          };
          if (meta?.position !== undefined) setCollapsed(meta.position, meta.collapsed ?? false);
          // Keyboard navigation, Find, and search reveals open hidden ancestors.
          if ((tr.selectionSet || !previous.enabled) && !meta?.collapsed) {
            for (const $pos of [tr.selection.$anchor, tr.selection.$head]) {
              for (let depth = 1; depth < $pos.depth; depth++) {
                const node = $pos.node(depth);
                if (node.type.name !== "listItem" || $pos.pos < $pos.start(depth) + node.firstChild!.nodeSize) continue;
                const pos = $pos.before(depth);
                if (decorations.find(pos, pos + 1).some(decoration => decoration.from === pos && decoration.spec.collapsed)) setCollapsed(pos, false);
              }
            }
          }
          return { ...settings, initialized: true, enabled, decorations, collapsedCount };
        },
      },
      props: { decorations: state => {
        const folds = listFoldingKey.getState(state);
        return folds?.enabled ? folds.decorations : DecorationSet.empty;
      } },
    })];
  },
});
