import adventure from "../themes/8-bit-adventure.json";
import oldBasementPC from "../themes/old-basement-pc.json";
import starfall from "../themes/starfall-studio.json";
import classic from "../themes/classic.json";
import minimal from "../themes/minimal.json";
import cupertino from "../themes/cupertino.json";
import baseline from "../themes/baseline.json";
import { parseTheme, themesMatch, type ThemeDocument } from "./themes";

// Older notebook preset IDs remain valid; their definitions now use Theme API 1.
export const classicThemes: ThemeDocument[] = classic.map(parseTheme);
// Full documents keep bundled artwork and CSS portable with each notebook.
export const bundledThemes: ThemeDocument[] = [minimal, cupertino, baseline, starfall, oldBasementPC, adventure].map(parseTheme);
export const allBuiltInThemes = [...classicThemes, ...bundledThemes];

export function isBundledTheme(theme: ThemeDocument | null): boolean {
  return !!theme && bundledThemes.some((bundled) => bundled.id === theme.id && themesMatch(bundled, theme));
}
