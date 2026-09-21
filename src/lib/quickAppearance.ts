import type { CSSProperties } from "react";
import type { NotebookAppearance } from "../types";
import type { ThemeDocument } from "./themes";
import { readableThemeText } from "./themeRuntime";
import { allBuiltInThemes } from "./bundledThemes";
import { defaultThemeDesign } from "./themeDesign";

export function quickAppearanceStyles(quick: NotebookAppearance["quickAppearance"], colored: boolean, titlebarColor: string) {
  const palette: Record<string, string> = {};
  if (quick?.accentColor && /^#[0-9a-f]{6}$/i.test(quick.accentColor)) {
    palette["--tigrana-accent"] = quick.accentColor;
    palette["--tigrana-selected-text"] = readableThemeText(quick.accentColor);
    palette["--accent"] = quick.accentColor;
    palette["--accent-active"] = quick.accentColor;
    palette["--accent-contrast"] = readableThemeText(quick.accentColor);
    palette["--accent-soft"] = `color-mix(in srgb, ${quick.accentColor} 25%, transparent)`;
  }
  // An accent change follows a theme's colored title bar, but cannot enable it.
  const titlebar: CSSProperties = palette["--accent"] && colored
    ? { background: titlebarColor, color: readableThemeText(titlebarColor) }
    : {};
  return { palette: palette as CSSProperties, titlebar };
}

// Reuse packaged font data and notices so this list follows the shipped themes.
const packagedFonts = allBuiltInThemes.flatMap(theme => Object.entries(theme.design?.assets ?? {})
  .filter(([, asset]) => asset.mime === "font/woff2")
  .map(([path, asset]) => {
    const token = `theme-font-${path.slice(7, -6)}`;
    const value = [theme.editorFontFamily, theme.appFontFamily].find(family => family.split(",")[0].trim() === token)
      ?? `${token}, sans-serif`;
    return { label: themeFontLabel(token), value, token, path, asset, license: theme.design!.license };
  }))
  .filter((font, index, fonts) => fonts.findIndex(other => other.value === font.value) === index)
  .sort((a, b) => a.label.localeCompare(b.label));

// Bundled families and local system fallbacks only; no remote font downloads.
export const quickEditorFonts = [
  { label: "Sans serif (Inter)", value: "Inter, sans-serif" },
  { label: "System font", value: "system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, serif" },
  { label: "Monospace", value: "ui-monospace, monospace" },
  ...packagedFonts.map(({ label, value }) => ({ label, value })),
];

export type QuickAppearanceField = keyof NonNullable<NotebookAppearance["quickAppearance"]>;

/** Reset just one quick control, including any legacy value underneath its override. */
export function quickAppearanceResetPatch(theme: ThemeDocument, quick: NotebookAppearance["quickAppearance"], field: QuickAppearanceField): Partial<NotebookAppearance> {
  return {
    quickAppearance: { ...quick, [field]: undefined },
    ...(field === "accentColor" ? {
      colors: { light: { accentColor: theme.light.accent }, dark: { accentColor: theme.dark.accent } },
    } : { [field]: theme[field] }),
  };
}

/** Validate notebook overrides before placing them in generated theme CSS. */
export function applyQuickAppearanceFonts(theme: ThemeDocument, quick: NotebookAppearance["quickAppearance"]): ThemeDocument {
  let family = quickEditorFonts.find(font => font.value === quick?.editorFontFamily)?.value;
  const size = quick?.editorFontSize;
  const packagedFont = packagedFonts.find(font => font.value === family);
  let design = theme.design;
  if (packagedFont) {
    const original = design ?? defaultThemeDesign;
    // An imported theme may use the same filename for a different font. Never
    // overwrite it: its interface or custom CSS may still depend on that asset.
    let path = packagedFont.path;
    let suffix = 1;
    while (original.assets[path] && original.assets[path].data !== packagedFont.asset.data) {
      path = packagedFont.path.replace(".woff2", `-quick-${suffix++}.woff2`);
    }
    family = family!.replace(packagedFont.token, `theme-font-${path.slice(7, -6)}`);
    design = {
      ...original,
      assets: { ...original.assets, [path]: packagedFont.asset },
      license: original.license.includes(packagedFont.license) ? original.license
        : `${original.license}\n\nBundled ${packagedFont.label} font: original package notices follow.\n${packagedFont.license}`,
    };
  }
  return { ...theme,
    ...(packagedFont ? { schemaVersion: 2, design } : {}),
    ...(family ? { editorFontFamily: family } : {}),
    ...(typeof size === "number" && Number.isFinite(size) && size >= 11 && size <= 28
      ? { editorFontSize: size } : {}),
  };
}

/** Display the original family name rather than its renderer-scoped asset token. */
export function themeFontLabel(family: string): string {
  const first = family.split(",")[0].trim().replace(/^["']|["']$/g, "");
  const names: Record<string, string> = {
    "theme-font-ibm-plex-mono": "IBM Plex Mono",
    "theme-font-solway": "Solway",
    "theme-font-vt323": "VT323",
    "serif": "Serif",
    "sans-serif": "Sans serif",
    "monospace": "Monospace",
    "system-ui": "System font",
    "ui-sans-serif": "System sans serif",
    "ui-serif": "System serif",
    "ui-monospace": "System monospace",
  };
  return names[first] ?? first.replace(/^theme-font-/, "").replace(/-/g, " ");
}
