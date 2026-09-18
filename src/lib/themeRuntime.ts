import type { ThemeDocument } from "./themes";
import { defaultThemeDesign } from "./themeDesign";
import { compileThemeCss } from "./themeCss";
export function themeVariables(theme: ThemeDocument, mode: "light" | "dark") {
  const p = theme[mode],
    metrics = theme.design?.metrics ?? defaultThemeDesign.metrics;
  return {
    "--tigrana-background": p.background,
    "--tigrana-surface": p.surface,
    "--tigrana-text": p.text,
    "--tigrana-editor-text": p.editorText ?? "var(--tigrana-text)",
    "--tigrana-selected-text": p.selectedText ?? readableThemeText(p.accent),
    "--tigrana-highlight-text": p.highlightText ?? "#000000",
    "--tigrana-highlight-background": p.highlightBackground ?? "#ffff00",
    "--tigrana-muted": p.textMuted,
    "--tigrana-accent": p.accent,
    "--tigrana-border": p.border,
    "--tigrana-radius": `${metrics.radius}px`,
    "--tigrana-spacing": `${metrics.spacing}`,
    "--tigrana-line-height": `${metrics.lineHeight}`,
    "--app-bg": "var(--tigrana-background)",
    "--surface": "var(--tigrana-surface)",
    "--surface-soft": p.surfaceSoft,
    "--surface-strong": p.surfaceStrong,
    "--surface-muted": p.surfaceMuted,
    "--text": "var(--tigrana-text)",
    "--text-muted": "var(--tigrana-muted)",
    "--muted": "var(--tigrana-muted)",
    "--border": "var(--tigrana-border)",
    "--accent": "var(--tigrana-accent)",
    "--accent-contrast": "var(--tigrana-selected-text)",
    "--accent-soft": `color-mix(in srgb, ${p.accent} 25%, transparent)`,
    "--accent-active": p.accent,
    "--accent-strong": p.text,
    "--link-color":
      "color-mix(in srgb, var(--tigrana-accent) 45%, var(--tigrana-editor-text) 55%)",
    "--titlebar-bg": p.titlebar,
    "--titlebar-contrast": readableThemeText(p.titlebar),
    "--app-font-family": theme.appFontFamily,
    "--app-font-size": `${theme.appFontSize}px`,
    "--editor-font-family": theme.editorFontFamily,
    "--editor-font-size": `${theme.editorFontSize}px`,
  };
}
export function readableThemeText(hex: string) {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722 > 0.54
    ? "#192d2b"
    : "#ffffff";
}
export function themeStylesheet(
  theme: ThemeDocument,
  mode: "light" | "dark",
  region: string,
) {
  const variables = themeVariables(theme, mode);
  // Values have already passed parseTheme. Never interpolate unvalidated imports.
  const tokens = `[data-theme-region="${region}"]{${Object.entries(variables)
    .map(([key, value]) => `${key}:${value}`)
    .join(";")}}`;
  return tokens + surfaceStyles(theme, region) + (theme.design ? compileThemeCss(theme.design, region) : "");
}

/** Surface overrides are confined to notebook regions, never Settings/dialogs. */
export function surfaceStyles(theme: ThemeDocument, region: string, embedAssets = true) {
  const s = theme.surfaces;
  if (!s) return '';
  const root = `[data-theme-region="${region}"]`;
  const asset = s.image ? theme.design?.assets[s.image] : undefined;
  const image = asset?.mime.startsWith('image/') ? `url("${embedAssets ? `data:${asset.mime};base64,${asset.data}` : s.image}")` : 'none';
  return `
${root} { --tigrana-editor-opacity: ${s.editor}%; }
${root}.app-frame.theme-standard { background-color: ${s.background}; }
${root}.app-frame { background-image: ${image}; background-size: cover; background-position: center; }
${root} .left-panes, ${root} .note-surface { background: transparent; backdrop-filter: none; }
${root} :is(.folder-pane,.notes-pane,.unified-tree-pane) { background-color: color-mix(in srgb,var(--surface) ${s.navigation}%,transparent); }
${root} .main-pane { background-color: color-mix(in srgb,var(--app-bg) ${s.editor}%,transparent); }
${root} .right-sidebar { background-color: color-mix(in srgb,var(--surface) ${s.outline}%,transparent); }
${root}.app-titlebar { background-color: color-mix(in srgb,${theme.accentTitlebar ? "var(--titlebar-bg)" : "var(--surface)"} ${s.titlebar}%,transparent); }
`;
}
