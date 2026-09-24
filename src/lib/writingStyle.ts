import { closesMarkdownCodeFence, readMarkdownCodeFence, type MarkdownCodeFence } from "./markdownCodeFence";

export type WritingStyle = "notes" | "story";
export type NewNoteWritingStyle = "last-used" | WritingStyle;
export type ParagraphIndent = "indent" | "none";

export function readWritingStyle(frontmatter: string): WritingStyle {
  return /^tigrana_writing_style\s*:\s*(?:story|"story"|'story')\s*(?:#.*)?$/m.test(frontmatter) ? "story" : "notes";
}

export function setWritingStyle(frontmatter: string, style: WritingStyle): string {
  // Replace this reserved field, including any nested value entered in raw mode.
  const lines = frontmatter.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^tigrana_writing_style\s*:/.test(line)) { skipping = true; continue; }
    if (skipping && /^\s+\S/.test(line)) continue;
    if (/^\S/.test(line)) skipping = false;
    kept.push(line);
  }
  return [...kept.join("\n").trimEnd().split("\n"), `tigrana_writing_style: ${style}`].join("\n").trim();
}

export function readParagraphIndentMarker(line: string): ParagraphIndent | null {
  return /^<!-- tigrana:paragraph (indent|none) -->$/.exec(line)?.[1] as ParagraphIndent | undefined ?? null;
}

export function stripParagraphIndentMarkers(text: string): string {
  if (!text.includes("<!-- tigrana:paragraph ")) return text;
  let fence: MarkdownCodeFence | null = null;
  return text.split("\n").filter(line => {
    if (fence) {
      if (closesMarkdownCodeFence(line, fence)) fence = null;
      return true;
    }
    fence = readMarkdownCodeFence(line);
    return Boolean(fence) || !readParagraphIndentMarker(line.replace(/\r$/, ""));
  }).join("\n");
}

// Scope to direct children so lists, quotes, and tables keep their own layout.
export function storyParagraphCss(root: string): string {
  return `
${root} > p { margin-top: 0; margin-bottom: 0; text-indent: 0; }
${root} > p + p { margin-top: 0; margin-bottom: 0; text-indent: 1.5em; }
${root} > p[data-story-indent="indent"] { text-indent: 1.5em; }
${root} > p[data-story-indent="none"] { text-indent: 0; }
`;
}
