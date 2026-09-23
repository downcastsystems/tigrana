import palette from "./inlineColors.json";

export const inlineColors = palette;
export type InlineColorKind = "text" | "highlight";
export type InlineColorCommand = `textColor_${string}` | `highlightColor_${string}`;

export function isInlineColorCommand(command: string): command is InlineColorCommand {
  const match = /^(textColor|highlightColor)_(.+)$/.exec(command);
  return !!match && (match[2] === "default" || (match[1] === "highlightColor" && match[2] === "none") || palette.some(color => color.id === match[2]));
}

const namedColors: Record<string, string> = {
  black: "#000000", white: "#ffffff", gray: "#808080", grey: "#808080",
  red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  brown: "#a52a2a", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb",
  silver: "#c0c0c0", maroon: "#800000", olive: "#808000", lime: "#00ff00",
  aqua: "#00ffff", teal: "#008080", navy: "#000080", fuchsia: "#ff00ff",
};

/** Only opaque, literal colors are accepted from HTML. Never retain arbitrary CSS. */
export function normalizeInlineColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const named = namedColors[value.trim().toLowerCase()];
  if (typeof named === "string") return named;
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (hex) return `#${(hex[1].length === 3 ? [...hex[1]].map(c => c + c).join("") : hex[1]).toLowerCase()}`;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(value.trim());
  if (!rgb || rgb.slice(1).some(c => Number(c) > 255)) return null;
  return `#${rgb.slice(1).map(c => Number(c).toString(16).padStart(2, "0")).join("")}`;
}

export function inlineColorValue(element: Element, kind: InlineColorKind): string | null {
  const stored = normalizeInlineColor(element.getAttribute(kind === "text" ? "data-text-color" : "data-highlight-color"));
  if (stored) return stored;
  const property = kind === "text" ? "color" : "background-color";
  const value = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(element.getAttribute("style") ?? "")?.[1];
  return normalizeInlineColor(value);
}

export function inlineColorStyle(color: string, kind: InlineColorKind) {
  const preset = palette.find(entry => entry[kind].light === color);
  return preset ? `var(--note-${kind}-${preset.id}, ${color})` : color;
}

/** Shared by the editor and the palette, independent of the notebook's accent. */
export const inlineColorVariables = (mode: "light" | "dark") => Object.fromEntries(
  palette.flatMap(color => (["text", "highlight"] as const).map(kind => [`--note-${kind}-${color.id}`, color[kind][mode]])),
);

/** Restore only balanced spans with color/background-color declarations. */
export function restoreInlineColorSpans(html: string): string {
  return transformInlineColorSpans(html, false);
}

export function stripInlineColorSpans(text: string): string {
  return transformInlineColorSpans(text, true);
}

function transformInlineColorSpans(html: string, strip: boolean): string {
  const tokens = [...html.matchAll(strip ? /<(\/?)span\b([^>]*?)>/gi : /&lt;(\/?)span\b([\s\S]*?)&gt;/gi)];
  const stack: number[] = [];
  const replacements = new Map<number, string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token[1]) { stack.push(i); continue; }
    const opening = stack.pop();
    if (opening === undefined || token[2].trim()) continue;
    const attrs = tokens[opening][2];
    const match = (strip ? /^\s+style=(?:"([^]*?)"|'([^]*?)')\s*$/i : /^\s+style=(?:&quot;([^]*?)&quot;|'([^]*?)')\s*$/i).exec(attrs);
    if (!match) continue;
    const declarations = (match[1] ?? match[2]).split(";").map(s => s.trim()).filter(Boolean);
    const safe: string[] = [];
    for (const declaration of declarations) {
      const part = /^(color|background-color)\s*:\s*(.+)$/i.exec(declaration);
      const color = part && normalizeInlineColor(part[2]);
      if (!part || !color) break;
      safe.push(`${part[1].toLowerCase()}: ${color}`);
    }
    if (!safe.length || safe.length !== declarations.length) continue;
    replacements.set(opening, strip ? "" : `<span style="${safe.join("; ")}">`);
    replacements.set(i, strip ? "" : "</span>");
  }
  const output: string[] = [];
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    const replacement = replacements.get(i);
    if (replacement === undefined) continue;
    output.push(html.slice(start, tokens[i].index!), replacement);
    start = tokens[i].index! + tokens[i][0].length;
  }
  output.push(html.slice(start));
  return output.join("");
}
