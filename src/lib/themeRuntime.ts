import { resolveTypography } from "./themeOptions";
import { inlineColorVariables } from "./inlineColors";
import type { ThemeDocument } from "./themes";
import { defaultThemeDesign } from "./themeDesign";
import { compileThemeCss } from "./themeCss";
/** Identical palettes represent one appearance, including its glass lighting. */
export function themeRenderingMode(theme: ThemeDocument, requested: "light" | "dark"): "light" | "dark" {
  const keys = Object.keys({ ...theme.light, ...theme.dark }) as (keyof ThemeDocument["light"])[];
  if (keys.some(key => theme.light[key] !== theme.dark[key])) return requested;
  return readableThemeText(theme[requested].background) === "#ffffff" ? "dark" : "light";
}

export function themeVariables(theme: ThemeDocument, mode: "light" | "dark", region?: string): Record<string, string> {
  const p = theme[mode],
    metrics = theme.design?.metrics ?? defaultThemeDesign.metrics;
  // Packaged fonts have region-specific names, just like the compiler's @font-face rules.
  const fontFamily = (family: string) => region ? family.replace(/theme-font-([a-zA-Z0-9_-]+)/g, (token, name: string) =>
    theme.design?.assets[`assets/${name}.woff2`]?.mime === "font/woff2" ? `tigrana-${region}-${name}` : token) : family;
  return {
    ...inlineColorVariables(themeRenderingMode(theme, mode)),
    ...Object.fromEntries(Object.entries(resolveTypography(theme)).map(([key, size]) => [`--tigrana-font-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`, `${size}px`])),
    ...Object.fromEntries((theme.controls ?? []).map(c => [`--tigrana-control-${c.id}`, String(typeof c.value === 'boolean' ? Number(c.value) : c.value)])),
    "--tigrana-menu-selected-background": p.menuSelectedBackground ?? "var(--tigrana-accent)",
    "--tigrana-menu-selected-text": p.menuSelectedText ?? (p.menuSelectedBackground ? readableThemeText(p.menuSelectedBackground) : "var(--tigrana-selected-text)"),
    "--tigrana-hover-background": p.hoverBackground ?? "var(--tigrana-accent)",
    "--tigrana-hover-text": p.hoverText ?? (p.hoverBackground ? readableThemeText(p.hoverBackground) : "var(--tigrana-selected-text)"),
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
    "--tigrana-line-height": `${theme.editorLineHeight ?? metrics.lineHeight}`,
    "--tigrana-letter-spacing": `${theme.editorLetterSpacing ?? 0}em`,
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
    "--app-font-family": fontFamily(theme.appFontFamily),
    "--app-font-size": `${theme.appFontSize}px`,
    "--editor-font-family": fontFamily(theme.editorFontFamily),
    "--editor-font-size": `${theme.editorFontSize}px`,
  };
}
/** Choose the higher-contrast foreground, including pale accent colors. */
export function readableThemeText(hex: string) {
  const luminance = (color: string) => {
    const c = [1, 3, 5].map(i => {
      const v = parseInt(color.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const background = luminance(hex);
  return (background + 0.05) / (luminance("#000000") + 0.05) > 1.05 / (background + 0.05)
    ? "#000000" : "#ffffff";
}
export function themeStylesheet(
  theme: ThemeDocument,
  mode: "light" | "dark",
  region: string,
) {
  const variables = themeVariables(theme, mode, region);
  // Values have already passed parseTheme. Never interpolate unvalidated imports.
  const tokens = `[data-theme-region="${region}"]{${Object.entries(variables)
    .map(([key, value]) => `${key}:${value}`)
    .join(";")}}`;
  return tokens + surfaceStyles(theme, region) + (theme.design ? compileThemeCss(theme.design, region) : "");
}

/** Share the packaged landscape with the GPU without external image requests. */
export function themeBackgroundImage(theme: ThemeDocument): string | undefined {
  const asset = theme.surfaces?.image ? theme.design?.assets[theme.surfaces.image] : undefined;
  return asset?.mime.startsWith("image/") ? `data:${asset.mime};base64,${asset.data}` : undefined;
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
${image !== 'none' ? `.app-shell[data-plasma]:has(> .plasma-background[data-plasma-image-ready]) ${root}.app-frame { background-image: none; }` : ''}
${root} .left-panes, ${root} .note-surface { background: transparent; backdrop-filter: none; }
${root} :is(.folder-pane,.notes-pane,.unified-tree-pane) { background-color: color-mix(in srgb,var(--surface) ${s.navigation}%,transparent); }
${root} .main-pane { background-color: color-mix(in srgb,var(--app-bg) ${s.editor}%,transparent); }
${root} .right-sidebar { background-color: color-mix(in srgb,var(--surface) ${s.outline}%,transparent); }
${root}.app-titlebar { background-color: color-mix(in srgb,${theme.accentTitlebar ? "var(--titlebar-bg)" : "var(--surface)"} ${s.titlebar}%,transparent); }
`;
}
