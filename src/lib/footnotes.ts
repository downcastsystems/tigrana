import { remark } from "remark";
import remarkGfm from "remark-gfm";
import type { RootContent } from "mdast";

const parser = remark().use(remarkGfm);
export type FootnoteDefinition = { label: string; body: string; preview: string; markdown: string; from: number; to: number };
export type FootnoteReference = { label: string; from: number; to: number; number: number };
export type FootnoteEntry = { label: string; number: number | null; body: string | null; preview: string; references: number; duplicate: boolean };
export const footnoteKey = (label: string) => label.toLowerCase();
export const footnoteAnchor = (label: string) => `footnote-${encodeURIComponent(footnoteKey(label))}`;
export const validFootnoteLabel = (label: string) => /^[^\s[\]<>]+$/.test(label);

export function footnoteMarkdown(label: string, body: string) {
  const lines = body.replace(/\r\n/g, "\n").trim().split("\n");
  return `[^${label}]: ${lines[0]}${lines.slice(1).map(line => `\n${line ? `    ${line}` : ""}`).join("")}`;
}

type ParsedFootnotes = {
  readonly definitions: readonly Readonly<FootnoteDefinition>[];
  readonly references: readonly Readonly<FootnoteReference>[];
};
// Conversion and the sidebar read the same note. Keep only two recent sources,
// with a size cap, so opening notebooks does not retain their entire contents.
const parsedCache = new Map<string, ParsedFootnotes>();
const maxCachedSourceLength = 1_000_000;

/** Use the existing Markdown parser so references in code, escapes, and URLs stay literal. */
export function parseFootnotes(markdown: string): ParsedFootnotes {
  const cached = parsedCache.get(markdown);
  if (cached) {
    parsedCache.delete(markdown);
    parsedCache.set(markdown, cached);
    return cached;
  }
  const definitions: FootnoteDefinition[] = [];
  const references: FootnoteReference[] = [];
  const numbers = new Map<string, number>();
  if (!markdown.includes("[^")) return { definitions, references };
  const addReference = (label: string, from: number, to: number) => {
    if (!validFootnoteLabel(label)) return;
    const key = footnoteKey(label);
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    references.push({ label, from, to, number: numbers.get(key)! });
  };
  const visit = (node: RootContent) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return;
    if (node.type === "footnoteDefinition") {
      const source = markdown.slice(from, to);
      const label = /^\[\^([^\]]+)\]:/.exec(source)?.[1] ?? node.label ?? node.identifier;
      const lines = source.replace(/^\[\^[^\]]+\]:[ \t]*/, "").split("\n");
      const body = [lines[0], ...lines.slice(1).map(line => line.replace(/^(?: {1,4}|\t)/, ""))].join("\n");
      definitions.push({ label, body, preview: node.children.map(footnotePreviewText).join("\n\n"), markdown: source, from, to });
      return;
    }
    if (node.type === "footnoteReference") {
      addReference(markdown.slice(from + 2, to - 1), from, to);
      return;
    }
    if (node.type === "text") {
      const source = markdown.slice(from, to);
      for (const match of source.matchAll(/(?<!\\)\[\^([^\]\s]+)\]/g)) {
        addReference(match[1], from + match.index!, from + match.index! + match[0].length);
      }
    } else if ("children" in node && node.type !== "link" && node.type !== "linkReference") {
      node.children.forEach(child => visit(child as RootContent));
    }
  };
  parser.parse(markdown).children.forEach(visit);
  const result = Object.freeze({
    definitions: Object.freeze(definitions.map(item => Object.freeze(item))),
    references: Object.freeze(references.map(item => Object.freeze(item))),
  });
  if (markdown.length <= maxCachedSourceLength) {
    parsedCache.set(markdown, result);
    if (parsedCache.size > 2) parsedCache.delete(parsedCache.keys().next().value!);
  }
  return result;
}

const entryCache = new Map<string, readonly FootnoteEntry[]>();

/** Reuse sidebar data supplied by an editor whose footnotes have not changed. */
export function cacheFootnoteEntries(markdown: string, entries: readonly FootnoteEntry[]) {
  if (markdown.length > maxCachedSourceLength) return;
  entryCache.delete(markdown);
  entryCache.set(markdown, entries);
  if (entryCache.size > 2) entryCache.delete(entryCache.keys().next().value!);
}

export function footnoteEntries(markdown: string): readonly FootnoteEntry[] {
  const cached = entryCache.get(markdown);
  if (cached) return cached;
  const { definitions, references } = parseFootnotes(markdown);
  const entries = new Map<string, FootnoteEntry>();
  for (const reference of references) {
    const key = footnoteKey(reference.label);
    const entry = entries.get(key);
    if (entry) entry.references++;
    else entries.set(key, { label: reference.label, number: reference.number, body: null, preview: "", references: 1, duplicate: false });
  }
  for (const definition of definitions) {
    const key = footnoteKey(definition.label);
    const entry = entries.get(key);
    if (entry) {
      if (entry.body !== null) entry.duplicate = true;
      else { entry.body = definition.body; entry.preview = definition.preview; }
    } else entries.set(key, { label: definition.label, number: null, body: definition.body, preview: definition.preview, references: 0, duplicate: false });
  }
  const result = Object.freeze([...entries.values()].map(entry => Object.freeze(entry)));
  cacheFootnoteEntries(markdown, result);
  return result;
}

/** Plain readable sidebar text, without exposing Markdown formatting delimiters. */
function footnotePreviewText(node: RootContent): string {
  if ("value" in node) return node.value;
  if (node.type === "image") return node.alt ?? "";
  if (!("children" in node)) return "";
  const children = node.children.map(child => footnotePreviewText(child as RootContent));
  if (node.type === "list") return children.map((child, index) => `${node.ordered ? `${(node.start ?? 1) + index}.` : "•"} ${child}`).join("\n");
  return children.join(node.type === "paragraph" || node.type === "link" || node.type === "strong" || node.type === "emphasis" || node.type === "delete" ? "" : "\n");
}

export function footnotePreview(markdown: string): string {
  return parser.parse(markdown).children.map(footnotePreviewText).join("\n\n");
}
