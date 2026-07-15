import Fuse from "fuse.js";
import type { NoteEntry, NotePositionMetadata, SearchResult } from "../types";

export type SearchSort = "relevance" | "edited-desc" | "edited-asc" | "title";
export type SearchDateRange = "any" | "today" | "week" | "month";

export type SearchOptions = {
  dateRange?: SearchDateRange;
  folderPath?: string | null;
  limit?: number;
  now?: number;
  sort?: SearchSort;
  titleOnly?: boolean;
};

const dateRangeDays: Record<Exclude<SearchDateRange, "any">, number> = {
  today: 1,
  week: 7,
  month: 30,
};

export function searchNotes(
  notes: NoteEntry[],
  contents: Map<string, string>,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const trimmed = normalizeQuery(query);
  if (!trimmed) return [];

  const now = options.now ?? Date.now();
  const docs = filterNotes(notes, options, now).map((note) => ({
    ...note,
    content: noteBody(contents.get(note.path) ?? ""),
  }));

  const fuse = new Fuse(docs, {
    keys: options.titleOnly
      ? [{ name: "title", weight: 1 }]
      : [
          { name: "title", weight: 0.62 },
          { name: "path", weight: 0.23 },
          { name: "content", weight: 0.15 },
        ],
    includeScore: true,
    threshold: 0.35,
    ignoreLocation: true,
  });

  const results = fuse.search(trimmed).map((result) => {
    const updatedAt = (result.item.updated_at ?? 0) * 1000;
    const age = Math.max(0, now - updatedAt);
    const recencyBoost = Math.max(0, 1 - age / (30 * 86_400_000)) * 0.06;
    const { content, ...note } = result.item;
    return {
      ...note,
      score: Math.max(0, (result.score ?? 0) - recencyBoost),
      snippet: makeSnippet(content, trimmed),
    };
  });

  return sortResults(results, options.sort ?? "relevance").slice(0, options.limit ?? 50);
}

export function recentNotes(
  notes: NoteEntry[],
  contents: Map<string, string>,
  positions: Record<string, NotePositionMetadata>,
  options: SearchOptions = {},
): { fallback: boolean; results: SearchResult[] } {
  const now = options.now ?? Date.now();
  const filtered = filterNotes(notes, options, now);
  const recentlyViewed = filtered
    .filter((note) => (positions[note.path]?.lastOpenedAt ?? 0) > 0)
    .sort((a, b) => (positions[b.path]?.lastOpenedAt ?? 0) - (positions[a.path]?.lastOpenedAt ?? 0));
  const fallback = recentlyViewed.length === 0;
  const defaultOrder = fallback
    ? [...filtered].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
    : recentlyViewed;
  const ordered = sortRecentNotes(defaultOrder, options.sort ?? "relevance");

  return {
    fallback,
    results: ordered.slice(0, options.limit ?? 20).map((note) => ({
      ...note,
      score: 0,
      snippet: makeSnippet(noteBody(contents.get(note.path) ?? ""), ""),
    })),
  };
}

export function noteSearchPreview(markdown: string, limit = 900) {
  const body = noteBody(markdown)
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body.slice(0, limit);
}

function normalizeQuery(query: string) {
  const trimmed = query.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function filterNotes(notes: NoteEntry[], options: SearchOptions, now: number) {
  const folderPath = options.folderPath ?? null;
  const since = options.dateRange && options.dateRange !== "any"
    ? options.dateRange === "today"
      ? new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()
      : now - dateRangeDays[options.dateRange] * 86_400_000
    : null;

  return notes.filter((note) => {
    if (folderPath !== null) {
      const inFolder = note.parent_path === folderPath || (folderPath && note.parent_path.startsWith(`${folderPath}/`));
      if (!inFolder) return false;
    }
    if (since !== null && (note.updated_at ?? 0) * 1000 < since) return false;
    return true;
  });
}

function sortRecentNotes(notes: NoteEntry[], sort: SearchSort) {
  if (sort === "edited-desc") return [...notes].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
  if (sort === "edited-asc") return [...notes].sort((a, b) => (a.updated_at ?? 0) - (b.updated_at ?? 0));
  if (sort === "title") return [...notes].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return notes;
}

function sortResults(results: SearchResult[], sort: SearchSort) {
  return [...results].sort((a, b) => {
    if (sort === "edited-desc") return (b.updated_at ?? 0) - (a.updated_at ?? 0);
    if (sort === "edited-asc") return (a.updated_at ?? 0) - (b.updated_at ?? 0);
    if (sort === "title") return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    return a.score - b.score;
  });
}

function noteBody(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized;
  const closingIndex = normalized.indexOf("\n---", 4);
  if (closingIndex === -1) return normalized;
  return normalized.slice(closingIndex + 4).replace(/^\n+/, "");
}

function makeSnippet(content: string, query: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!query) return compact.slice(0, 180);
  const lower = compact.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index === -1) return compact.slice(0, 180);
  const start = Math.max(0, index - 65);
  const end = Math.min(compact.length, index + query.length + 110);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}
