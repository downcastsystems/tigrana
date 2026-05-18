import Fuse from "fuse.js";
import type { NoteEntry, SearchResult } from "../types";

export function searchNotes(notes: NoteEntry[], contents: Map<string, string>, query: string): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const docs = notes.map((note) => ({
    ...note,
    content: contents.get(note.path) ?? "",
  }));

  const fuse = new Fuse(docs, {
    keys: [
      { name: "title", weight: 0.6 },
      { name: "path", weight: 0.25 },
      { name: "content", weight: 0.15 },
    ],
    includeScore: true,
    threshold: 0.35,
    ignoreLocation: true,
  });

  return fuse.search(trimmed).slice(0, 12).map((result) => ({
    ...result.item,
    score: result.score ?? 0,
    snippet: makeSnippet(result.item.content, trimmed),
  }));
}

function makeSnippet(content: string, query: string) {
  const lower = content.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index === -1) return content.replace(/\s+/g, " ").trim().slice(0, 140);
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + query.length + 90);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}
