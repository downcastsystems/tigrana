import starfall from "../themes/starfall-studio.json";
import { parseTheme, themesMatch, type ThemeDocument } from "./themes";

// Full documents keep bundled artwork and CSS portable with each notebook.
export const bundledThemes: ThemeDocument[] = [parseTheme(starfall)];

export function isBundledTheme(theme: ThemeDocument | null): boolean {
  return !!theme && bundledThemes.some((bundled) => bundled.id === theme.id && themesMatch(bundled, theme));
}
