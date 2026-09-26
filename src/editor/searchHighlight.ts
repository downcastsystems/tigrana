import { Extension } from "@tiptap/core";
import { type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

export const searchHighlightKey = new PluginKey<SearchHighlightState>("searchHighlight");

type SearchHighlightState = {
  activeIndex: number;
  decorations: DecorationSet;
  query: string;
};

type SearchHighlightMeta = {
  activeIndex: number;
  query: string;
};

export const SearchHighlight = Extension.create({
  name: "searchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchHighlightState>({
        key: searchHighlightKey,
        state: {
          init: () => ({
            activeIndex: 0,
            decorations: DecorationSet.empty,
            query: "",
          }),
          apply(transaction, value, _oldState, newState) {
            const meta = transaction.getMeta(searchHighlightKey) as SearchHighlightMeta | undefined;
            if (meta) {
              return {
                activeIndex: meta.activeIndex,
                decorations: buildSearchDecorations(newState.doc, meta.query, meta.activeIndex),
                query: meta.query,
              };
            }
            if (transaction.docChanged && value.query) {
              return {
                ...value,
                decorations: buildSearchDecorations(newState.doc, value.query, value.activeIndex),
              };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return searchHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export function getEditorMatches(editor: Editor, query: string) {
  return getDocumentMatches(editor.state.doc, query);
}

export function getDocumentMatches(doc: ProseMirrorNode, query: string) {
  const normalizedQuery = query.toLowerCase();
  const matches: Array<{ from: number; to: number }> = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let index = text.indexOf(normalizedQuery);
    while (index !== -1) {
      matches.push({ from: pos + index, to: pos + index + query.length });
      index = text.indexOf(normalizedQuery, index + Math.max(query.length, 1));
    }
  });

  return matches;
}

function buildSearchDecorations(doc: ProseMirrorNode, query: string, activeIndex: number) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return DecorationSet.empty;
  const decorations = getDocumentMatches(doc, trimmedQuery).map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === activeIndex ? "search-match is-active" : "search-match",
    }),
  );
  return DecorationSet.create(doc, decorations);
}

export function scrollEditorPositionIntoView(editor: Editor, position: number, behavior: ScrollBehavior = "smooth") {
  const scrollContainer = editor.view.dom.closest<HTMLElement>(".note-surface");
  if (!scrollContainer) return;
  const coords = editor.view.coordsAtPos(position);
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetTop = scrollContainer.scrollTop + coords.top - containerRect.top - containerRect.height * 0.42;
  scrollContainer.scrollTo({
    top: Math.max(0, targetTop),
    behavior,
  });
}
