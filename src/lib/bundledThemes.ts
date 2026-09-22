import quest from "../themes/quest.json";
import oldBasementPC from "../themes/old-basement-pc.json";
import starfall from "../themes/starfall-studio.json";
import classic from "../themes/classic.json";
import vampire from "../themes/vampire.json";
import minimal from "../themes/minimal.json";
import saratoga from "../themes/saratoga.json";
import based from "../themes/based.json";
import typewriter from "../themes/typewriter.json";
import { themesMatch, type ThemeDocument } from "./themes";

import { loadThemeCatalog, recoveryTheme } from "./themeCatalog";
const classicDocuments = [...classic, vampire];
export const builtInThemeDocuments = [...classicDocuments, minimal, saratoga, based, starfall, oldBasementPC, quest, typewriter];
const legacy = loadThemeCatalog(classicDocuments);
const bundled = loadThemeCatalog([minimal, saratoga, based, starfall, oldBasementPC, quest, typewriter]);
export const themeCatalogWarnings = [...legacy.warnings, ...bundled.warnings];
export const classicThemes: ThemeDocument[] = legacy.themes.some(t => t.id === 'default') ? legacy.themes : [recoveryTheme, ...legacy.themes];
export const bundledThemes = bundled.themes;
export const allBuiltInThemes = [...classicThemes, ...bundledThemes];

export function isBundledTheme(theme: ThemeDocument | null): boolean {
  return !!theme && bundledThemes.some((bundled) => bundled.id === theme.id && themesMatch(bundled, theme));
}
