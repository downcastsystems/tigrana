export type TextAlignment = "left" | "center" | "right";

export function readTextAlignment(style: string | null): TextAlignment | null {
  const value = /(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i.exec(style ?? "")?.[1];
  return value ? value.toLowerCase() as TextAlignment : null;
}

// A narrow, portable HTML wrapper. Blank lines allow Markdown inside the div.
export const alignmentOpening = /^<div style="text-align: (center|right)">$/;
export function stripAlignmentWrappers(text: string) {
  return text.replace(/^<div style="text-align: (?:center|right)">\n\n([\s\S]*?)\n\n<\/div>$/gm, "$1");
}
