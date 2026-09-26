import { stripInlineColorSpans } from "./inlineColors";
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

  // Numbers may extend the query's final number, but never shorten it or use typos.
  const quoted = isQuotedQuery(query);
  const literalOnly = quoted || /\d/.test(trimmed);
  const literal = literalPattern(trimmed);
  const prefix = !quoted && /\d$/.test(trimmed) ? literalPattern(trimmed, true) : null;
  const now = options.now ?? Date.now();
  const docs = filterNotes(notes, options, now).map((note) => ({
    ...note,
    content: noteBody(contents.get(note.path) ?? "").replace(/\s+/g, " ").trim(),
  }));
  const exact: Array<{ item: typeof docs[number]; score: number }> = [];
  const remaining: typeof docs = [];
  for (const doc of docs) {
    const title = doc.title.replace(/\s+/g, " ");
    const fields = options.titleOnly ? [title] : [title, doc.path.replace(/\s+/g, " "), doc.content];
    const field = fields.findIndex(text => literal.test(text));
    if (field >= 0) exact.push({ item: doc, score: field });
    else {
      const prefixField = prefix ? fields.findIndex(text => prefix.test(text)) : -1;
      if (prefixField >= 0) exact.push({ item: doc, score: 3 + prefixField });
      else if (!literalOnly) remaining.push(doc);
    }
  }
  const fuzzy = literalOnly ? [] : new Fuse(remaining, {
    keys: options.titleOnly
      ? [{ name: "title", weight: 1 }]
      : [{ name: "title", weight: 0.62 }, { name: "path", weight: 0.23 }, { name: "content", weight: 0.15 }],
    includeScore: true,
    threshold: 0.35,
    ignoreLocation: true,
    ignoreFieldNorm: true,
  }).search(trimmed).map(result => ({ item: result.item, score: 6 + (result.score ?? 1) }));

  const bodies = new Map<string, string>();
  const results = [...exact, ...fuzzy].map(({ item, score }) => {
    const age = Math.max(0, now - (item.updated_at ?? 0) * 1000);
    const recencyBoost = Math.max(0, 1 - age / (30 * 86_400_000)) * 0.06;
    const { content, ...note } = item;
    bodies.set(note.path, content);
    return { ...note, score: score + 0.06 - recencyBoost, snippet: "" };
  });
  // Build excerpts only for visible results, not every matching Note.
  return sortResults(results, options.sort ?? "relevance").slice(0, options.limit ?? 50).map(note => ({
    ...note, snippet: makeSnippet(bodies.get(note.path) ?? "", query, !literalOnly && !options.titleOnly),
  }));
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
    return trimmed.slice(1, -1).trim().replace(/\s+/g, " ");
  }
  return trimmed.replace(/\s+/g, " ");
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
  const normalized = stripInlineColorSpans(markdown.replace(/\r\n/g, "\n"));
  if (!normalized.startsWith("---\n")) return normalized;
  const closingIndex = normalized.indexOf("\n---", 4);
  if (closingIndex === -1) return normalized;
  return normalized.slice(closingIndex + 4).replace(/^\n+/, "");
}

function makeSnippet(content: string, query: string, allowFuzzy = true) {
  const compact = content.replace(/\s+/g, " ").trim();
  const match = findSearchMatch(compact, query);
  query = normalizeQuery(query);
  if (!query) return compact.slice(0, 180);
  const index = match?.start ?? -1;
  if (index === -1) {
    if (!allowFuzzy) return compact.slice(0, 180);
    // Search bounded overlapping passages without includeMatches. Collecting
    // Fuse match indices for a whole large Note can overflow its call stack.
    const passages: string[] = [];
    const width = Math.max(240, query.length * 2);
    const stride = Math.max(1, width - Math.max(60, query.length));
    for (let offset = 0; offset < compact.length; offset += stride) passages.push(compact.slice(offset, offset + width));
    const match = new Fuse(passages, { threshold: 0.35, ignoreLocation: true, ignoreFieldNorm: true }).search(query, { limit: 1 })[0];
    if (!match) return compact.slice(0, 180);
    const start = match.refIndex * stride;
    return `${start > 0 ? "…" : ""}${match.item}${start + match.item.length < compact.length ? "…" : ""}`;
  }
  const start = Math.max(0, index - 65);
  const end = Math.min(compact.length, index + query.length + 110);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function isQuotedQuery(query: string) {
  return /^"[\s\S]*"$/.test(query.trim());
}

function literalPattern(query: string, allowNumericPrefix = false) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\d+/g, (digits: string, offset: number) => {
    const suffix = allowNumericPrefix && offset + digits.length === escaped.length ? "" : "(?![0-9])";
    return `(?<![0-9])${digits}${suffix}`;
  });
  return new RegExp(pattern.replace(/\s+/g, "\\s+"), "i");
}

export function findSearchMatch(text: string, query: string): { start: number; end: number } | null {
  const normalized = normalizeQuery(query);
  if (!normalized) return null;
  const match = literalPattern(normalized).exec(text)
    ?? (!isQuotedQuery(query) && /\d$/.test(normalized) ? literalPattern(normalized, true).exec(text) : null);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

// Fuzzy location work is bounded to short passages; never collect Fuse indices
// across an entire long Note.
export function findSearchPassage(text: string, query: string): { start: number; end: number } | null {
  const literal = findSearchMatch(text, query);
  if (literal) return literal;
  const normalized = normalizeQuery(query);
  if (!normalized || isQuotedQuery(query) || /\d/.test(normalized)) return null;
  const width = Math.max(240, normalized.length * 2);
  const stride = Math.max(1, width - Math.max(60, normalized.length));
  const passages: string[] = [];
  for (let offset = 0; offset < text.length; offset += stride) passages.push(text.slice(offset, offset + width));
  const best = new Fuse(passages, { threshold: 0.35, ignoreLocation: true, ignoreFieldNorm: true }).search(normalized, { limit: 1 })[0];
  if (!best) return null;
  const indices = new Fuse([best.item], { threshold: 0.35, ignoreLocation: true, includeMatches: true })
    .search(normalized)[0]?.matches?.[0]?.indices;
  if (!indices?.length) return null;
  const offset = best.refIndex * stride;
  return { start: offset + indices[0][0], end: offset + indices[indices.length - 1][1] + 1 };
}
