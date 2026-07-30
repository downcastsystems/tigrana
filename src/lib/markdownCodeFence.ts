export type MarkdownCodeFence = {
  character: "`" | "~";
  info: string;
  length: number;
};

export function readMarkdownCodeFence(line: string): MarkdownCodeFence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;

  const character = match[1][0] as MarkdownCodeFence["character"];
  const info = match[2].trim();
  if (character === "`" && info.includes("`")) return null;
  return { character, info, length: match[1].length };
}

export function closesMarkdownCodeFence(line: string, fence: MarkdownCodeFence) {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  return Boolean(
    match
    && match[1][0] === fence.character
    && match[1].length >= fence.length
  );
}

export function markdownCodeFenceDelimiter(code: string) {
  let longestRun = 0;
  for (const match of code.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  return "`".repeat(Math.max(3, longestRun + 1));
}
