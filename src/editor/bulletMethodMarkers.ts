import { bulletMethodIconUrl } from "../lib/bulletMethodIcons";
import { Extension, InputRule } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { canJoin, Mapping } from "@tiptap/pm/transform";
import { bulletMoveHighlightKey, createBulletMoveHighlightPlugin } from "./bulletMoveHighlight";
import { sortAfterStatusClick } from "./sortLines";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { bulletMethodDimPercent, defaultBulletMethodDisplay, type BulletMethodDisplay, defaultBulletMethodStatuses, firstBulletMethodStatus, statusShortcut, statusDims, statusIcon, nextBulletMethodStatus, type BulletMethodStatus } from "../lib/bulletMethod";

type MarkerState = { decorations: DecorationSet; statuses: readonly BulletMethodStatus[]; display: BulletMethodDisplay };
export const bulletMethodMarkersKey = new PluginKey<MarkerState>("bulletMethodMarkers");

function marker(node: ProseMirrorNode, statuses: readonly BulletMethodStatus[]) {
  const paragraph = node.firstChild;
  if (paragraph?.type.name !== "paragraph") return null;
  // Only read the prefix, even when a list item contains a very long note.
  const limit = Math.max(0, ...statuses.map(status => status.prefix?.length ?? 0)) + 2;
  const text = paragraph.textBetween(0, Math.min(limit, paragraph.content.size), "", "\0");
  const colon = text.indexOf(":");
  if (colon < 0) return null;
  const prefix = text.slice(0, colon).trim().toUpperCase();
  const status = statuses.find(status => status.prefix !== null && status.prefix.trim().toUpperCase() === prefix);
  return status ? { status, colon } : null;
}

function decorationsIn(doc: ProseMirrorNode, from: number, to: number, statuses: readonly BulletMethodStatus[], display: BulletMethodDisplay, positions?: Set<number>) {
  const decorations: Decoration[] = [];
  if (!display.enabled) return decorations;
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name !== "listItem") return;
    positions?.add(pos);
    if (parent?.type.name !== "bulletList") return;
    const match = marker(node, statuses);
    const icon = match && statusIcon(match.status);
    const paragraph = node.firstChild;
    const completePrefix = paragraph?.type.name === "paragraph" && /^COMPLETE:/i.test(paragraph.textBetween(0, Math.min(9, paragraph.content.size)));
    // COMPLETE remains a legacy alias for DONE unless explicitly configured.
    const dimStatus = match?.status ?? (completePrefix ? statuses.find(status => status.id === "done") : statuses.find(status => status.prefix === null));
    const dimmed = display.dimCompleted && dimStatus !== undefined && statusDims(dimStatus);
    const attributes: Record<string, string> = {};
    if (dimmed) {
      attributes["data-bullet-method-completed"] = "true";
      attributes.style = `--bullet-dim-light: ${bulletMethodDimPercent(display, "light")}%; --bullet-dim-dark: ${bulletMethodDimPercent(display, "dark")}%`;
      decorations.push(Decoration.node(pos + 1, pos + 1 + node.firstChild!.nodeSize, { "data-bullet-method-dim": "true", style: `--bullet-dim-light: ${bulletMethodDimPercent(display, "light")}%; --bullet-dim-dark: ${bulletMethodDimPercent(display, "dark")}%` }));
    }
    if (display.replaceBullets && icon) attributes["data-bullet-method-marker"] = icon;
    if (Object.keys(attributes).length) decorations.push(Decoration.node(pos, pos + node.nodeSize, attributes));
    if (!display.replaceBullets || !icon || !match) return;
    const next = nextBulletMethodStatus(match.status, statuses);
    // Keep the non-editable button outside the paragraph. WebKit otherwise
    // includes the preceding newline when double-clicking its first word.
    decorations.push(Decoration.widget(pos + 1, (view, getPos) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bullet-method-marker-button";
      button.contentEditable = "false";
      button.dataset.icon = icon;
      button.style.setProperty("--bullet-method-marker", `url("${bulletMethodIconUrl(icon)}")`);
      button.setAttribute("aria-label", next ? `${match.status.prefix}: change to ${next.prefix}` : match.status.prefix!);
      button.title = button.getAttribute("aria-label")!;
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", event => {
        event.preventDefault();
        if (!view.editable || !next) return;
        const widgetPos = getPos();
        if (widgetPos === undefined) return;
        const start = widgetPos + 1;
        const paragraph = view.state.doc.resolve(start).parent;
        const current = marker(view.state.doc.resolve(start).node(-1), statuses);
        if (!current || current.status.id !== match.status.id) return;
        const surface = view.dom.closest<HTMLElement>(".note-surface");
        const anchorTop = event.detail > 0 && surface ? button.getBoundingClientRect().top : null;
        const marks = paragraph.firstChild?.marks;
        const tr = closeHistory(view.state.tr).replaceWith(start, start + current.colon,
          view.state.schema.text(next.prefix!, marks));
        const settings = bulletMethodMarkersKey.getState(view.state);
        let clicked = start + Math.min(next.prefix!.length + 2, paragraph.content.size + next.prefix!.length - current.colon);
        const beforeSort = clicked;
        if (settings?.display.autoSortOnClick !== false) {
          clicked = sortAfterStatusClick(tr, clicked, settings?.statuses ?? statuses);
        }
        tr.setMeta(bulletMoveHighlightKey, clicked !== beforeSort ? tr.doc.resolve(clicked).before() : null);
        view.dispatch(tr);
        // Keep the same point of the clicked bullet under the pointer. The
        // browser clamps at the document edges when exact anchoring is impossible.
        let pointerAnchored = false;
        if (anchorTop !== null && surface && clicked !== beforeSort) {
          const paragraphDOM = view.nodeDOM(view.state.doc.resolve(clicked).before());
          const movedButton = paragraphDOM instanceof HTMLElement
            ? paragraphDOM.closest("li")?.querySelector<HTMLElement>(":scope > .bullet-method-marker-button") : null;
          if (movedButton) {
            const scrollBehavior = surface.style.scrollBehavior;
            surface.style.scrollBehavior = "auto";
            surface.scrollTop += movedButton.getBoundingClientRect().top - anchorTop;
            surface.style.scrollBehavior = scrollBehavior;
            pointerAnchored = true;
          }
        }
        // Clicking a status always focuses that item's text, without undoing
        // the pointer's scroll anchor when the item has moved.
        const selectionTr = view.state.tr.setSelection(TextSelection.create(view.state.doc, clicked)).setMeta("addToHistory", false);
        view.dispatch(pointerAnchored ? selectionTr : selectionTr.scrollIntoView());
        view.dispatch(closeHistory(view.state.tr));
        view.focus();
      });
      return button;
    }, { key: JSON.stringify([icon, match.status, next]), side: -1, stopEvent: () => true }));

  });
  return decorations;
}

export const BulletMethodMarkers = Extension.create({
  name: "bulletMethodMarkers",
  addInputRules() {
    return [new InputRule({
      find: /^(-[^\s:][^:\r\n]*:|\S{1,8}:) $/,
      handler: ({ state, range, match, chain }) => {
        const settings = bulletMethodMarkersKey.getState(state);
        if (!settings?.display.enabled || settings.display.shortcutsEnabled === false) return null;
        const typed = match[1];
        const namedStatus = typed.startsWith("-")
          ? settings.statuses.find(row => row.prefix !== null && row.prefix.trim().toUpperCase() === typed.slice(1, -1).toUpperCase())
          : undefined;
        const status = typed === "-:" ? firstBulletMethodStatus(settings.statuses)
          : namedStatus ?? settings.statuses.find(row => statusShortcut(row) === typed);
        if (!status) return null;
        const prefix = status.prefix?.trim();
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size) return null;
        const inBullet = $from.depth >= 3 && $from.node(-1).type.name === "listItem"
          && $from.node(-2).type.name === "bulletList" && $from.index(-1) === 0;
        if ($from.depth !== 1 && !inBullet) return null;
        const conversion = chain().command(({ tr }) => {
          tr.insertText(prefix ? `${prefix}: ` : "", range.from, range.to);
          return true;
        });
        if (!inBullet) {
          conversion.wrapInList("bulletList").command(({ tr }) => {
            // Match the regular dash input rule: wrapping alone leaves adjacent
            // lists separate, so explicitly join the preceding bullet list.
            const boundary = range.from - 1;
            const before = tr.doc.resolve(boundary).nodeBefore;
            if (before?.type.name === "bulletList" && canJoin(tr.doc, boundary)) tr.join(boundary);
            return true;
          });
        }
        // Include the trailing paragraph in this transaction so the trailing-node
        // plugin cannot clear the input rule's immediate Backspace undo record.
        conversion.command(({ tr }) => {
          if (tr.doc.lastChild?.type.name === "bulletList") {
            tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.create());
          }
          return true;
        }).run();
      },
    })];
  },
  addProseMirrorPlugins() {
    return [createBulletMoveHighlightPlugin(), new Plugin<MarkerState>({
      key: bulletMethodMarkersKey,
      state: {
        init: (_, state) => ({
          statuses: defaultBulletMethodStatuses,
          display: defaultBulletMethodDisplay,
          decorations: DecorationSet.create(state.doc, decorationsIn(state.doc, 0, state.doc.content.size, defaultBulletMethodStatuses, defaultBulletMethodDisplay)),
        }),
        apply(tr, previous) {
          const statuses = tr.getMeta(bulletMethodMarkersKey) as readonly BulletMethodStatus[] | undefined;
          const display = tr.getMeta("bulletMethodDisplay") as BulletMethodDisplay | undefined;
          if (statuses || display) {
            const nextStatuses = statuses ?? previous.statuses;
            const nextDisplay = display ?? previous.display;
            return { statuses: nextStatuses, display: nextDisplay, decorations: DecorationSet.create(tr.doc, decorationsIn(tr.doc, 0, tr.doc.content.size, nextStatuses, nextDisplay)) };
          }
          if (!tr.docChanged) return previous;
          // Map against each intermediate document when undo unwraps a list;
          // mapping nested dimming decorations straight to the final doc can
          // leave ProseMirror checking a node boundary inside a text fragment.
          let decorations = previous.decorations;
          tr.mapping.maps.forEach((map, index) => {
            decorations = decorations.map(new Mapping([map]), tr.docs[index + 1] ?? tr.doc);
          });
          const positions = new Set<number>();
          // A paragraph decoration and its preceding widget share a start.
          const updated = new Map<string, Decoration>();
          tr.mapping.maps.forEach((map, index) => {
            const remaining = tr.mapping.slice(index + 1);
            map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
              const from = Math.max(0, remaining.map(newFrom, -1) - 1);
              const to = Math.min(tr.doc.content.size, remaining.map(newTo, 1) + 1);
              for (const decoration of decorationsIn(tr.doc, from, to, previous.statuses, previous.display, positions)) updated.set(`${decoration.from}:${decoration.to}`, decoration);
            });
          });
          // Recheck changed items and their ancestors, not every item on each key.
          for (const pos of positions) decorations = decorations.remove(decorations.find(pos, pos + 2).filter(decoration => decoration.from >= pos && decoration.from <= pos + 2));
          decorations = decorations.add(tr.doc, [...updated.values()]);
          return { statuses: previous.statuses, display: previous.display, decorations };
        },
      },
      props: {
        decorations: state => bulletMethodMarkersKey.getState(state)?.decorations,
      },
    })];
  },
});
