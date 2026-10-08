import { bulletCelebrationKey, createBulletCelebrationPlugin } from "./bulletCelebration";
import { bulletMethodIconUrl } from "../lib/bulletMethodIcons";
import { Extension, InputRule } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { AddMarkStep, RemoveMarkStep, canJoin, Mapping } from "@tiptap/pm/transform";
import { bulletMoveHighlightKey, createBulletMoveHighlightPlugin } from "./bulletMoveHighlight";
import { sortAfterStatusClick } from "./sortLines";
import { listFoldingKey } from "./listFolding";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { bulletMethodDimPercent, defaultBulletMethodDisplay, type BulletMethodDisplay, defaultBulletMethodStatuses, firstBulletMethodStatus, statusShortcut, statusCelebrates, statusDims, statusIcon, nextBulletMethodStatus, statusBolds, type BulletMethodStatus } from "../lib/bulletMethod";

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

function decorationsIn(doc: ProseMirrorNode, from: number, to: number, statuses: readonly BulletMethodStatus[], display: BulletMethodDisplay, positions?: Set<number>, textblocks?: Map<number, number>) {
  const decorations: Decoration[] = [];
  if (!display.enabled) return decorations;
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.isTextblock) {
      textblocks?.set(pos, pos + node.nodeSize);
      // WebKit paints synthesized bold with an opaque foreground even when
      // its inherited color has alpha. Composite only uncolored bold runs;
      // CSS activates the fade when this paragraph inherits status dimming.
      const $pos = doc.resolve(pos);
      let inListItem = false;
      for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type.name === "listItem") { inListItem = true; break; }
      }
      if (display.dimmedStatusesEnabled !== false && inListItem && node.type.name === "paragraph") node.forEach((child, offset) => {
        if (child.isText && child.marks.some(mark => mark.type.name === "bold")
          && !child.marks.some(mark => mark.type.name === "textColor" || mark.type.name === "highlight")) {
          const start = pos + 1 + offset;
          decorations.push(Decoration.inline(start, start + child.nodeSize, { class: "bullet-method-dim-bold" }, { dimBold: true }));
        }
      });
      return false;
    }
    if (node.type.name !== "listItem") return;
    positions?.add(pos);
    if (parent?.type.name !== "bulletList") return;
    const match = marker(node, statuses);
    const icon = match && statusIcon(match.status);
    const paragraph = node.firstChild;
    const completePrefix = paragraph?.type.name === "paragraph" && /^COMPLETE:/i.test(paragraph.textBetween(0, Math.min(9, paragraph.content.size)));
    // COMPLETE remains a legacy alias for DONE unless explicitly configured.
    const dimStatus = match?.status ?? (completePrefix ? statuses.find(status => status.id === "done") : statuses.find(status => status.prefix === null));
    const dimmed = display.dimmedStatusesEnabled !== false && dimStatus !== undefined && statusDims(dimStatus);
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
    const previous = nextBulletMethodStatus(match.status, statuses, -1);
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
      button.title = `${button.getAttribute("aria-label")!}${previous ? ` (Shift-click: ${previous.prefix})` : ""}`;
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", event => {
        event.preventDefault();
        const destination = event.shiftKey ? previous : next;
        if (!view.editable || !destination) return;
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
          view.state.schema.text(destination.prefix!, marks));
        const settings = bulletMethodMarkersKey.getState(view.state);
        if (settings?.display.boldStatusesEnabled !== false && view.state.schema.marks.bold) {
          if (statusBolds(destination)) {
            tr.addMark(start, start + destination.prefix!.length + 1, view.state.schema.marks.bold.create());
          } else {
            // An unchecked destination must not inherit the previous label's bold.
            tr.removeMark(start, start + destination.prefix!.length + 1, view.state.schema.marks.bold);
          }
        }
        let clicked = start + Math.min(destination.prefix!.length + 2, paragraph.content.size + destination.prefix!.length - current.colon);
        const beforeSort = clicked;
        if (settings?.display.autoSortOnClick !== false) {
          clicked = sortAfterStatusClick(tr, clicked, settings?.statuses ?? statuses);
        }
        tr.setMeta(bulletMoveHighlightKey, clicked !== beforeSort ? tr.doc.resolve(clicked).before() : null);
        // Resolve after sorting so the fold follows the clicked parent.
        if (destination.id === "done" && settings?.display.autoCollapseDone === true) {
          tr.setMeta(listFoldingKey, { position: tr.doc.resolve(clicked).before(-1), collapsed: true });
        }
        if (settings?.display.celebrationsEnabled !== false && statusCelebrates(destination)) tr.setMeta(bulletCelebrationKey, tr.doc.resolve(clicked).before());
        view.dispatch(tr);
        // Keep the same point of the clicked bullet under the pointer. The
        // browser clamps at the document edges when exact anchoring is impossible.
        if (anchorTop !== null && surface && clicked !== beforeSort) {
          const paragraphDOM = view.nodeDOM(view.state.doc.resolve(clicked).before());
          const movedButton = paragraphDOM instanceof HTMLElement
            ? paragraphDOM.closest("li")?.querySelector<HTMLElement>(":scope > .bullet-method-marker-button") : null;
          if (movedButton) {
            const scrollBehavior = surface.style.scrollBehavior;
            surface.style.scrollBehavior = "auto";
            surface.scrollTop += movedButton.getBoundingClientRect().top - anchorTop;
            surface.style.scrollBehavior = scrollBehavior;
          }
        }
        // A pointer click already targets visible text. Do not request caret
        // margins even when sorting leaves the item in place: near the upper
        // edge that needlessly scrolls the note. Keyboard activation may scroll.
        const selectionTr = view.state.tr.setSelection(TextSelection.create(view.state.doc, clicked)).setMeta("addToHistory", false);
        if (settings?.display.boldStatusesEnabled !== false && selectionTr.selection.$from.parent.content.size === destination.prefix!.length + 1) {
          // With no body or separating space yet, the caret touches the bold
          // label. Keep the next typed text from inheriting its generated bold.
          selectionTr.setStoredMarks(selectionTr.selection.$from.marks().filter(mark => mark.type.name !== "bold"));
        }
        view.dispatch(anchorTop !== null ? selectionTr : selectionTr.scrollIntoView());
        view.dispatch(closeHistory(view.state.tr));
        view.focus();
      });
      return button;
    }, { key: JSON.stringify([icon, match.status, next, previous]), side: -1, stopEvent: () => true }));

  });
  return decorations;
}

export const BulletMethodMarkers = Extension.create({
  name: "bulletMethodMarkers",
  addInputRules() {
    return [new InputRule({
      find: /^[^:\r\n]+:$/,
      handler: ({ state, range, match }) => {
        const settings = bulletMethodMarkersKey.getState(state);
        const bold = state.schema.marks.bold;
        if (!settings?.display.enabled || settings.display.boldStatusesEnabled === false || !bold) return null;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== "paragraph" || $from.depth < 3
          || $from.node(-1).type.name !== "listItem" || $from.node(-2).type.name !== "bulletList"
          || $from.index(-1) !== 0 || range.from !== $from.start()) return null;
        const prefix = match[0].slice(0, -1).trim().toUpperCase();
        const status = settings.statuses.find(status => status.prefix !== null && status.prefix.trim().toUpperCase() === prefix);
        if (!status || !statusBolds(status)) return null;
        const tr = state.tr;
        const typingMarks = tr.storedMarks ?? $from.marks();
        // Insert only the new input so split formatting in the label survives.
        tr.insertText(match[0].slice($from.pos - range.from), $from.pos, range.to);
        tr.addMark(range.from, range.from + match[0].length, bold.create());
        tr.setStoredMarks(typingMarks);
      },
    }), new InputRule({
      find: /^(-[^\s:][^:\r\n]*:|(?=\S*:)\S{2,9}) $/,
      handler: ({ state, range, match, chain }) => {
        const settings = bulletMethodMarkersKey.getState(state);
        if (!settings?.display.enabled || settings.display.shortcutsEnabled === false) return null;
        const typed = match[1];
        const namedStatus = typed.startsWith("-") && typed.endsWith(":")
          ? settings.statuses.find(row => row.prefix !== null && row.prefix.trim().toUpperCase() === typed.slice(1, -1).toUpperCase())
          : undefined;
        const status = typed === "-:" ? firstBulletMethodStatus(settings.statuses)
          : namedStatus ?? settings.statuses.find(row => statusShortcut(row) === typed);
        if (!status) return null;
        const prefix = status.prefix?.trim();
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== "paragraph") return null;
        const inBullet = $from.depth >= 3 && $from.node(-1).type.name === "listItem"
          && $from.node(-2).type.name === "bulletList" && $from.index(-1) === 0;
        if ($from.depth !== 1 && !inBullet) return null;
        const conversion = chain().command(({ tr }) => {
          const typingMarks = tr.storedMarks ?? tr.selection.$from.marks();
          tr.insertText(prefix ? `${prefix}: ` : "", range.from, range.to);
          if (prefix && settings.display.boldStatusesEnabled !== false && state.schema.marks.bold) {
            if (statusBolds(status)) {
              tr.addMark(range.from, range.from + prefix.length + 1, state.schema.marks.bold.create());
            } else tr.removeMark(range.from, range.from + prefix.length + 1, state.schema.marks.bold);
            // Bold only the generated label, without changing the user's typing marks.
            tr.setStoredMarks(typingMarks);
          }
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
          if (statusCelebrates(status)) tr.setMeta(bulletCelebrationKey, tr.selection.$from.before());
          return true;
        }).run();
      },
    })];
  },
  addProseMirrorPlugins() {
    return [createBulletCelebrationPlugin(), createBulletMoveHighlightPlugin(), new Plugin<MarkerState>({
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
          const textblocks = new Map<number, number>();
          // A paragraph decoration and its preceding widget share a start.
          const updated = new Map<string, Decoration>();
          const recheck = (from: number, to: number) => {
            for (const decoration of decorationsIn(tr.doc, from, to, previous.statuses, previous.display, positions, textblocks)) updated.set(`${decoration.from}:${decoration.to}`, decoration);
          };
          tr.mapping.maps.forEach((map, index) => {
            const remaining = tr.mapping.slice(index + 1);
            map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
              const from = Math.max(0, remaining.map(newFrom, -1) - 1);
              const to = Math.min(tr.doc.content.size, remaining.map(newTo, 1) + 1);
              recheck(from, to);
            });
            // Mark changes have empty position maps but can split a bold run
            // or give it an explicit color. Recheck only their affected text.
            const step = tr.steps[index];
            if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
              recheck(remaining.map(step.from, -1), remaining.map(step.to, 1));
            }
          });
          // Recheck changed items and their ancestors, not every item on each key.
          for (const pos of positions) decorations = decorations.remove(decorations.find(pos, pos + 2).filter(decoration => decoration.from >= pos && decoration.from <= pos + 2));
          for (const [from, to] of textblocks) decorations = decorations.remove(decorations.find(from, to).filter(decoration => decoration.spec.dimBold));
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
