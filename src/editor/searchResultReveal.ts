import { Extension, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEffect, useRef } from "react";
import { findSearchPassage } from "../lib/search";
import { scrollEditorPositionIntoView } from "./searchHighlight";

export type SearchRevealRequest = { id: number; workspace: string; notePath: string; query: string };
export const searchResultRevealKey = new PluginKey<DecorationSet>("searchResultReveal");

export const SearchResultReveal = Extension.create({
  name: "searchResultReveal",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: searchResultRevealKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, current) {
          const range = transaction.getMeta(searchResultRevealKey) as { from: number; to: number } | null | undefined;
          if (range) return DecorationSet.create(transaction.doc, [Decoration.inline(range.from, range.to, {
            class: "search-match is-active search-result-reveal",
          })]);
          if (range === null || transaction.docChanged || transaction.selectionSet) return DecorationSet.empty;
          return current;
        },
      },
      props: { decorations: state => searchResultRevealKey.getState(state) },
    })];
  },
});

export function findDocumentSearchPassage(doc: Node, query: string) {
  let text = "";
  const segments: Array<{ start: number; end: number; position: number }> = [];
  doc.descendants((node, position) => {
    if (node.isTextblock || node.type.name === "hardBreak") text += "\n";
    if (node.isText && node.text) {
      segments.push({ start: text.length, end: text.length + node.text.length, position });
      text += node.text;
    }
  });
  const match = findSearchPassage(text, query);
  if (!match) return null;
  const first = segments.find(segment => segment.end > match.start);
  const last = segments.find(segment => segment.end >= match.end);
  return first && last ? {
    from: first.position + Math.max(0, match.start - first.start),
    to: last.position + match.end - last.start,
  } : null;
}

// Run after Note loading, saved-scroll restoration, and the editor's focus frames.
// Any interaction cancels a queued jump as well as an already visible highlight.
export function scheduleSearchReveal(surface: HTMLElement, reveal: () => void, clear: () => void) {
  let frame = 0;
  let cancelled = false;
  const dismiss = () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    clear();
  };
  const events = ["pointerdown", "keydown", "wheel", "touchstart", "beforeinput", "click"];
  events.forEach(event => surface.addEventListener(event, dismiss, true));
  let remaining = 3;
  const next = () => {
    if (cancelled) return;
    if (--remaining > 0) frame = requestAnimationFrame(next);
    else reveal();
  };
  frame = requestAnimationFrame(next);
  return () => {
    events.forEach(event => surface.removeEventListener(event, dismiss, true));
    dismiss();
  };
}

export function useSearchResultReveal(editor: Editor | null, request: SearchRevealRequest | null | undefined,
  workspace: string, notePath: string | null, reloadRequest: number | undefined) {
  const revealedRequest = useRef<SearchRevealRequest | null>(null);
  useEffect(() => {
    if (!editor || !request || revealedRequest.current === request || request.workspace !== workspace || request.notePath !== notePath) return;
    const surface = editor.view.dom.closest<HTMLElement>(".note-surface") ?? editor.view.dom;
    const clear = () => {
      if (!editor.isDestroyed && searchResultRevealKey.getState(editor.state)?.find().length) {
        editor.view.dispatch(editor.state.tr.setMeta(searchResultRevealKey, null));
      }
    };
    return scheduleSearchReveal(surface, () => {
      if (editor.isDestroyed) return;
      revealedRequest.current = request;
      const range = findDocumentSearchPassage(editor.state.doc, request.query);
      if (!range) return;
      // A caret at the passage lets typing start there without replacing the match.
      editor.commands.setTextSelection(range.from);
      editor.view.dom.focus({ preventScroll: true });
      editor.view.dispatch(editor.state.tr.setMeta(searchResultRevealKey, range));
      scrollEditorPositionIntoView(editor, range.from, "auto");
    }, clear);
  }, [editor, notePath, reloadRequest, request, workspace]);
}
