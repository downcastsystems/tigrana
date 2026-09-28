import { remark } from "remark";
import remarkGfm from "remark-gfm";
import type { RootContent } from "mdast";

const parser = remark().use(remarkGfm);
export type FootnoteDefinition = { label: string; body: string; markdown: string; from: number; to: number };
export type FootnoteReference = { label: string; from: number; to: number; number: number };
export type FootnoteEntry = { label: string; number: number | null; body: string | null; references: number; duplicate: boolean };
export const footnoteKey = (label: string) => label.toLowerCase();
export const footnoteAnchor = (label: string) => `footnote-${encodeURIComponent(footnoteKey(label))}`;
export const validFootnoteLabel = (label: string) => /^[^\s[\]<>]+$/.test(label);

export function footnoteMarkdown(label: string, body: string) {
  const lines = body.replace(/\r\n/g, "\n").trim().split("\n");
  return `[^${label}]: ${lines[0]}${lines.slice(1).map(line => `\n${line ? `    ${line}` : ""}`).join("")}`;
}

/** Use the existing Markdown parser so references in code, escapes, and URLs stay literal. */
export function parseFootnotes(markdown: string) {
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
      definitions.push({ label, body, markdown: source, from, to });
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
  return { definitions, references };
}

export function footnoteEntries(markdown: string): FootnoteEntry[] {
  const { definitions, references } = parseFootnotes(markdown);
  const entries = new Map<string, FootnoteEntry>();
  for (const reference of references) {
    const key = footnoteKey(reference.label);
    const entry = entries.get(key);
    if (entry) entry.references++;
    else entries.set(key, { label: reference.label, number: reference.number, body: null, references: 1, duplicate: false });
  }
  for (const definition of definitions) {
    const key = footnoteKey(definition.label);
    const entry = entries.get(key);
    if (entry) {
      if (entry.body !== null) entry.duplicate = true;
      else entry.body = definition.body;
    } else entries.set(key, { label: definition.label, number: null, body: definition.body, references: 0, duplicate: false });
  }
  return [...entries.values()];
}
