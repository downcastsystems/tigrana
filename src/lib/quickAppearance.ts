import type { CSSProperties } from "react";
import type { NotebookAppearance } from "../types";
import type { ThemeDocument } from "./themes";
import { readableThemeText, selectionBackgroundOpacity } from "./themeRuntime";
import { allBuiltInThemes } from "./bundledThemes";
import { defaultThemeDesign, parseThemeDesign } from "./themeDesign";
import vt323Font from "./vt323Font.json";

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
    ? { background: typeof quick?.panelOpacity === "number" && Number.isFinite(quick.panelOpacity) && quick.panelOpacity >= 0 && quick.panelOpacity <= 100
      ? `color-mix(in srgb, ${titlebarColor} ${quick.panelOpacity}%, transparent)` : titlebarColor, color: readableThemeText(titlebarColor) }
    : {};
  return { palette: palette as CSSProperties, titlebar };
}

// Reuse packaged font data and notices so this list follows the shipped themes.
const packagedFonts = [
  // VT323 remains a quick font even though Quest now uses Geist Pixel.
  { label: "VT323", value: "theme-font-vt323, monospace", token: "theme-font-vt323",
    path: "assets/vt323.woff2", ...vt323Font },
  ...allBuiltInThemes.flatMap(theme => Object.entries(theme.design?.assets ?? {})
  .filter(([, asset]) => asset.mime === "font/woff2")
  .map(([path, asset]) => {
    const token = `theme-font-${path.slice(7, -6)}`;
    const value = [theme.editorFontFamily, theme.appFontFamily].find(family => family.split(",")[0].trim() === token)
      ?? `${token}, sans-serif`;
    return { label: themeFontLabel(token), value, token, path, asset, license: theme.design!.license };
  })),
]
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
    ...(field === "panelOpacity" || field === "backgroundImage" || field === "editorLineHeight" || field === "editorLetterSpacing" ? {} : field === "accentColor" ? {
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
  const spacing = Object.fromEntries(([['editorLineHeight', 1.2, 2.2], ['editorLetterSpacing', -0.03, 0.12]] as const)
    .flatMap(([key, min, max]) => {
      const value = quick?.[key];
      return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? [[key, value]] : [];
    }));
  return { ...theme, ...spacing,
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

/** Mix sRGB channels so the persisted selection can choose a readable foreground. */
export function mixAccentColor(accent: string, text: string, weight: number) {
  return '#' + [1, 3, 5].map(index => Math.round(
    parseInt(accent.slice(index, index + 2), 16) * weight
    + parseInt(text.slice(index, index + 2), 16) * (1 - weight),
  ).toString(16).padStart(2, '0')).join('');
}

export function quickPanelOpacity(theme: ThemeDocument) {
  return theme.surfaces?.editor ?? (theme.plasma?.enabled ? Math.min(95, theme.plasma.frost * 1.1) : 100);
}

/** Apply notebook controls to a copy, which can also be exported as a theme. */
export function applyQuickAppearance(theme: ThemeDocument, quick: NotebookAppearance['quickAppearance']): ThemeDocument {
  let result = applyQuickAppearanceFonts(theme, quick);
  const rules: string[] = [];
  if (quick?.accentColor && /^#[0-9a-f]{6}$/i.test(quick.accentColor)) {
    const accent = quick.accentColor;
    const palette = (mode: 'light' | 'dark') => {
      const original = theme[mode];
      const text = original.editorText ?? original.text;
      const selectionBackground = mixAccentColor(accent, text, 0.65);
      return { ...original, accent, selectedText: readableThemeText(accent),
        linkColor: mixAccentColor(accent, text, 0.45), selectionBackground,
        selectionText: readableThemeText(selectionBackground, selectionBackgroundOpacity) };
    };
    result = { ...result, light: palette('light'), dark: palette('dark') };
    rules.push(':scope.app-titlebar.theme-light .note-tab.is-active, :scope.app-titlebar.theme-dark .note-tab.is-active { background: var(--tigrana-accent); color: var(--tigrana-selected-text); }');
  }
  const opacity = quick?.panelOpacity;
  const validOpacity = typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0 && opacity <= 100;
  let backgroundPath: string | undefined;
  if (quick?.backgroundImage) {
    try {
      const { asset } = quick.backgroundImage;
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[asset.mime];
      if (!extension) throw new Error('Unsupported background image.');
      const original = result.design ?? defaultThemeDesign;
      let path = `assets/quick-background.${extension}`;
      let suffix = 1;
      while (original.assets[path] && original.assets[path].data !== asset.data) path = `assets/quick-background-${suffix++}.${extension}`;
      const design = parseThemeDesign({ ...original, assets: { ...original.assets, [path]: asset } });
      result = { ...result, schemaVersion: 2, design };
      backgroundPath = path;
    } catch {
      // Malformed or oversized notebook overrides must not break the theme.
    }
  }
  if (validOpacity || backgroundPath) {
    const defaults = { background: theme.light.background, navigation: quickPanelOpacity(theme),
      editor: quickPanelOpacity(theme), outline: quickPanelOpacity(theme), titlebar: 100 };
    result = { ...result, surfaces: { ...(result.surfaces ?? defaults),
      ...(validOpacity ? { navigation: opacity, editor: opacity, outline: opacity, titlebar: opacity } : {}),
      ...(backgroundPath ? { image: backgroundPath } : {}) } };
    const backgroundRule = ':scope.app-frame.theme-standard { background-color: var(--tigrana-workspace-background, var(--surface-muted)); }';
    if (!theme.surfaces || theme.design?.css.includes(backgroundRule)) rules.push(backgroundRule);
    if (validOpacity) {
      // Paint just the panel backgrounds; children and text remain fully opaque.
      rules.push(`:scope.app-frame .left-panes, :scope.app-frame .note-surface { background: transparent; }
:scope.app-frame .folder-pane, :scope.app-frame .notes-pane, :scope.app-frame .unified-tree-pane, :scope.app-frame .right-sidebar { background: color-mix(in srgb, var(--surface) ${opacity}%, transparent); }
:scope.app-frame .main-pane { background: color-mix(in srgb, var(--app-bg) ${opacity}%, transparent); }
:scope.app-titlebar.theme-light, :scope.app-titlebar.theme-dark { background: color-mix(in srgb, ${theme.accentTitlebar ? 'var(--titlebar-bg)' : 'var(--surface)'} ${opacity}%, transparent); }`);
    }
  }
  if (rules.length) {
    const design = result.design ?? defaultThemeDesign;
    const css = design.css.replace(/\n?\/\* Notebook quick appearance \*\/[\s\S]*?\/\* End notebook quick appearance \*\//g, '').trimEnd();
    result = { ...result, schemaVersion: 2, design: { ...design,
      css: css + '\n/* Notebook quick appearance */\n' + rules.join('\n') + '\n/* End notebook quick appearance */' } };
  }
  return result;
}
