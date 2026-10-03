import type { CSSProperties } from "react";
import { defaultTheme } from "./bundledThemes";
import { resolveThemeVariant } from "./themes";

const startupTheme = resolveThemeVariant(defaultTheme, "blue");

export function startupThemeStyles(mode: "light" | "dark"): CSSProperties {
  const palette = startupTheme[mode];
  return {
    "--startup-background": palette.background,
    "--startup-surface": palette.surface,
    "--startup-hover": palette.hoverBackground ?? palette.surfaceSoft,
    "--startup-text": palette.text,
    "--startup-muted": palette.textMuted,
    "--startup-border": palette.border,
    "--startup-accent": palette.accent,
    "--startup-accent-text": palette.selectedText,
    "--startup-titlebar": palette.titlebar,
    "--startup-radius": `${startupTheme.design?.metrics.radius ?? 6}px`,
    "--startup-line-height": startupTheme.design?.metrics.lineHeight ?? 1.65,
    fontFamily: startupTheme.appFontFamily,
    fontSize: `${startupTheme.appFontSize}px`,
    colorScheme: mode,
  } as CSSProperties;
}
