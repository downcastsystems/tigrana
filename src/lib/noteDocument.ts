import { gitHubEmojis, shortcodeToEmoji } from "@tiptap/extension-emoji";

export type ParsedNoteMarkdown = {
  body: string;
  frontmatter: string;
  frontmatterError: string | null;
};

export type FrontmatterField = {
  editable: boolean;
  key: string;
  lineIndex: number;
  value: string;
};

export function splitMarkdownTitle(markdown: string, fallbackTitle: string) {
  return {
    title: fallbackTitle,
    body: markdown,
  };
}

export function parseNoteMarkdown(markdown: string): ParsedNoteMarkdown {
  const normalized = normalizeFrontmatterClosingFence(markdown).replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0].trim() !== "---") {
    return { body: markdown, frontmatter: "", frontmatterError: null };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return {
      body: markdown,
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
      frontmatter: "",
      frontmatterError: `This note has malformed frontmatter: ${validationError}. Opened as raw Markdown.`,
    };
  }

  return { body, frontmatter, frontmatterError: null };
}

export function composeMarkdown(frontmatter: string, body: string, preserveRawBody = false) {
  if (preserveRawBody) return body;
  const trimmedFrontmatter = frontmatter.trim();
  if (!trimmedFrontmatter) return body;
  return `---\n${trimmedFrontmatter}\n---\n\n${body.replace(/^\n+/, "")}`;
}

export function normalizeNoteContentForWatcher(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

export function validateFrontmatter(frontmatter: string) {
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

export function getFrontmatterFields(frontmatter: string): FrontmatterField[] {
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n");
  return lines.flatMap((line, index) => {
    const match = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) return [];
    const nextTopLevelIndex = lines.findIndex((nextLine, nextIndex) => nextIndex > index && /^\S/.test(nextLine));
    const blockEnd = nextTopLevelIndex === -1 ? lines.length : nextTopLevelIndex;
    const hasNestedContent = lines.slice(index + 1, blockEnd).some((nextLine) => {
      if (!nextLine.trim()) return false;
      return /^\s/.test(nextLine);
    });
    return [{
      editable: !hasNestedContent,
      key: match[1],
      lineIndex: index,
      value: match[2],
    }];
  });
}

export function updateFrontmatterField(frontmatter: string, field: FrontmatterField, value: string) {
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n");
  lines[field.lineIndex] = `${field.key}: ${value}`;
  return lines.join("\n");
}

export function previewNote(markdown: string) {
  return parseNoteMarkdown(markdown).body
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

export function getTextStats(text: string) {
  const plain = text
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    words: plain ? plain.split(/\s+/).length : 0,
    characters: plain.length,
  };
}

export function extractOutline(title: string, body: string) {
  const headings = title.trim() ? [{ level: 1, text: title.trim() }] : [];
  body.split("\n").forEach((line) => {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: inlineMarkdownToPlainText(match[2]) });
  });
  return headings.map((heading, index) => ({
    ...heading,
    id: `heading-${index}`,
  }));
}

export function inlineMarkdownToPlainText(value: string) {
  return value
    .replace(/:([a-zA-Z0-9_+-]+):/g, (match, shortcode: string) => shortcodeToEmoji(shortcode, gitHubEmojis)?.emoji ?? match)
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
