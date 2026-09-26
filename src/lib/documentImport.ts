import { inlineColors, normalizeInlineColor } from "./inlineColors";
export type ImportedAsset = { token: string; name: string; mime: string; bytes: Uint8Array };
export type ImportedDocument = { html: string; assets: ImportedAsset[]; warnings: string[] };
export function escapeImportText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function nearestImportColor(value: string, highlight = false): string | null {
  const color = normalizeInlineColor(value);
  if (!color) return null;
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const source = rgb(color);
  // Ordinary black/white body text should follow the notebook theme.
  if (Math.max(...source) - Math.min(...source) < 20) return highlight && source[0] < 240 ? inlineColors[0].highlight.light : null;
  const hue = ([r, g, b]: number[]) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    return ((max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d) * 60 + 360) % 360;
  };
  const sourceHue = hue(source);
  const colors = inlineColors.filter(c => c.id !== "gray");
  const match = colors.reduce((best, next) => {
    const distance = (hex: string) => { const difference = Math.abs(sourceHue - hue(rgb(hex))); return Math.min(difference, 360 - difference); };
    return distance(next.text.light) < distance(best.text.light) ? next : best;
  });
  return match[highlight ? "highlight" : "text"].light;
}
