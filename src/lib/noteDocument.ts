import { replaceEmojiShortcodes } from "./emoji";
import { closesMarkdownCodeFence, readMarkdownCodeFence, type MarkdownCodeFence } from "./markdownCodeFence";
import { measureNoteText, type NoteTextStats } from "./noteTextStats";

export { measureNoteText } from "./noteTextStats";
export type { NoteTextStats } from "./noteTextStats";

export type FrontmatterField = {
  editable: boolean;
  key: string;
  lineIndex: number;
  value: string;
};

export type NoteOutlineEntry = {
  id: string;
  level: number;
  text: string;
};

export type NoteDocument = {
  title: string;
  markdown: string;
  frontmatter: string;
  body: string;
  frontmatterError: string | null;
  frontmatterFields: FrontmatterField[];
  outline: NoteOutlineEntry[];
  preview: string;
  stats: NoteTextStats;
};

type NoteDocumentContent = Pick<NoteDocument, "title" | "frontmatter" | "body">;

type NoteDocumentRevision = Partial<NoteDocumentContent> & {
  markdown?: string;
};

type ParsedMarkdown = {
  body: string;
  canonicalMarkdown: string | null;
  frontmatter: string;
  frontmatterError: string | null;
};

export function readNoteDocument(markdown: string, title: string): NoteDocument {
  const parsed = parseMarkdown(markdown);
  return buildNoteDocument({
    title,
    markdown: parsed.canonicalMarkdown ?? markdown,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    frontmatterError: parsed.frontmatterError,
  });
}

export function readNotePreview(markdown: string) {
  return previewBody(parseMarkdown(markdown, false).body);
}

export function createNoteDocument({ title, frontmatter, body }: NoteDocumentContent): NoteDocument {
  const validationError = validateFrontmatter(frontmatter);
  return buildNoteDocument({
    title,
    frontmatter,
    body,
    markdown: composeMarkdown(frontmatter, body),
    frontmatterError: validationError ? `This note has malformed frontmatter: ${validationError}.` : null,
  });
}

export function reviseNoteDocument(document: NoteDocument, revision: NoteDocumentRevision): NoteDocument {
  const title = revision.title ?? document.title;
  if (revision.markdown !== undefined) return readNoteDocument(revision.markdown, title);
  return createNoteDocument({
    title,
    frontmatter: revision.frontmatter ?? document.frontmatter,
    body: revision.body ?? document.body,
  });
}

export function updateNoteDocumentFrontmatterField(document: NoteDocument, field: FrontmatterField, value: string) {
  const lines = document.frontmatter.replace(/\r\n/g, "\n").split("\n");
  lines[field.lineIndex] = `${field.key}: ${value}`;
  return reviseNoteDocument(document, { frontmatter: lines.join("\n") });
}

export function normalizeNoteMarkdown(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

function buildNoteDocument({
  title,
  markdown,
  frontmatter,
  body,
  frontmatterError,
}: NoteDocumentContent & Pick<NoteDocument, "markdown" | "frontmatterError">): NoteDocument {
  const frontmatterFields = lazyValue(() => readFrontmatterFields(frontmatter));
  const outline = lazyValue(() => extractNoteOutline(title, body));
  const preview = lazyValue(() => previewBody(body));
  const stats = lazyValue(() => measureNoteText(body));
  return {
    title,
    markdown,
    frontmatter,
    body,
    frontmatterError,
    get frontmatterFields() { return frontmatterFields(); },
    get outline() { return outline(); },
    get preview() { return preview(); },
    get stats() { return stats(); },
  };
}

function parseMarkdown(markdown: string, includeCanonicalMarkdown = true): ParsedMarkdown {
  const normalized = normalizeFrontmatterClosingFence(markdown).replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0].trim() !== "---") {
    return { body: markdown, canonicalMarkdown: null, frontmatter: "", frontmatterError: null };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return {
      body: markdown,
      canonicalMarkdown: null,
      frontmatter: "",
      frontmatterError: "This note starts with frontmatter, but the closing --- line is missing. Opened as raw Markdown.",
    };
  }

  const frontmatter = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n").replace(/^\n/, "");
  const validationError = validateFrontmatter(frontmatter);

  if (validationError) {
    return {
      body: markdown,
      canonicalMarkdown: null,
      frontmatter: "",
      frontmatterError: `This note has malformed frontmatter: ${validationError}. Opened as raw Markdown.`,
    };
  }

  return {
    body,
    canonicalMarkdown: includeCanonicalMarkdown ? composeMarkdown(frontmatter, body) : null,
    frontmatter,
    frontmatterError: null,
  };
}

function lazyValue<T>(create: () => T) {
  let initialized = false;
  let value: T;
  return () => {
    if (!initialized) {
      value = create();
      initialized = true;
    }
    return value;
  };
}

function composeMarkdown(frontmatter: string, body: string) {
  const trimmedFrontmatter = frontmatter.trim();
  if (!trimmedFrontmatter) return body;
  return `---\n${trimmedFrontmatter}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function validateFrontmatter(frontmatter: string) {
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n");
  let currentAllowsNested = false;

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    if (/^\s/.test(line)) {
      if (!currentAllowsNested) return `unexpected indentation near "${line.trim()}"`;
      continue;
    }

    const match = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) return `expected "key: value" near "${line.trim()}"`;
    currentAllowsNested = match[2].trim() === "" || /^[>|][+-]?$/.test(match[2].trim());
  }

  return null;
}

function readFrontmatterFields(frontmatter: string): FrontmatterField[] {
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n");
  return lines.flatMap((line, index) => {
    const match = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) return [];
    const nextTopLevelIndex = lines.findIndex((nextLine, nextIndex) => nextIndex > index && /^\S/.test(nextLine));
    const blockEnd = nextTopLevelIndex === -1 ? lines.length : nextTopLevelIndex;
    const hasNestedContent = lines.slice(index + 1, blockEnd).some((nextLine) => Boolean(nextLine.trim()) && /^\s/.test(nextLine));
    return [{
      editable: !hasNestedContent,
      key: match[1],
      lineIndex: index,
      value: match[2],
    }];
  });
}

function previewBody(body: string) {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^#\s+/.test(line.trim()))
    .join(" ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

export function extractNoteOutline(title: string, body: string): NoteOutlineEntry[] {
  const headings = title.trim() ? [{ level: 1, text: title.trim() }] : [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let codeFence: MarkdownCodeFence | null = null;

  lines.forEach((line) => {
    if (codeFence) {
      if (closesMarkdownCodeFence(line, codeFence)) codeFence = null;
      return;
    }

    const openingFence = readMarkdownCodeFence(line);
    if (openingFence) {
      codeFence = openingFence;
      return;
    }

    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: inlineMarkdownToPlainText(match[2]) });
  });
  return headings.map((heading, index) => ({ ...heading, id: `heading-${index}` }));
}

function inlineMarkdownToPlainText(value: string) {
  return replaceEmojiShortcodes(value)
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(^|[\s([{])_([^_\s][^_]*[^_\s]|[^_\s])_(?=$|[\s)\]}.,;:!?])/g, "$1$2")
    .replace(/\\([\\`*{}[\]()#+\-.!_>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFrontmatterClosingFence(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return markdown;

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  const smartDashIndex = lines.findIndex((line, index) => index > 0 && isSmartDashFence(line.trim()));
  if (smartDashIndex === -1 || (closingIndex !== -1 && closingIndex < smartDashIndex)) return markdown;

  lines[smartDashIndex] = "---";
  return lines.join("\n");
}

function isSmartDashFence(line: string) {
  return /^[\u2013\u2014\u2212]+$/.test(line);
}
