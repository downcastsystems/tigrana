import adventure from "../themes/8-bit-adventure.json";
import oldBasementPC from "../themes/old-basement-pc.json";
import starfall from "../themes/starfall-studio.json";
import classic from "../themes/classic.json";
import minimal from "../themes/minimal.json";
import cupertino from "../themes/cupertino.json";
import baseline from "../themes/baseline.json";
import { themesMatch, type ThemeDocument } from "./themes";

import { loadThemeCatalog, recoveryTheme } from "./themeCatalog";
export const builtInThemeDocuments = [...classic, minimal, cupertino, baseline, starfall, oldBasementPC, adventure];
const legacy = loadThemeCatalog(classic);
const bundled = loadThemeCatalog([minimal, cupertino, baseline, starfall, oldBasementPC, adventure]);
export const themeCatalogWarnings = [...legacy.warnings, ...bundled.warnings];
export const classicThemes: ThemeDocument[] = legacy.themes.some(t => t.id === 'default') ? legacy.themes : [recoveryTheme, ...legacy.themes];
export const bundledThemes = bundled.themes;
export const allBuiltInThemes = [...classicThemes, ...bundledThemes];

export function isBundledTheme(theme: ThemeDocument | null): boolean {
  return !!theme && bundledThemes.some((bundled) => bundled.id === theme.id && themesMatch(bundled, theme));
}
