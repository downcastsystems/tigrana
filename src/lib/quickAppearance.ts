import type { CSSProperties } from "react";
import type { NotebookAppearance } from "../types";
import type { ThemeDocument } from "./themes";
import { readableThemeText } from "./themeRuntime";

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

// These are bundled Inter or system fallbacks, never remote font downloads.
export const quickEditorFonts = [
  { label: "Sans serif (Inter)", value: "Inter, sans-serif" },
  { label: "Serif", value: "Georgia, serif" },
  { label: "Monospace", value: "ui-monospace, monospace" },
];

/** Validate notebook overrides before placing them in generated theme CSS. */
export function applyQuickAppearanceFonts(theme: ThemeDocument, quick: NotebookAppearance["quickAppearance"]): ThemeDocument {
  const family = quickEditorFonts.find(font => font.value === quick?.editorFontFamily)?.value;
  const size = quick?.editorFontSize;
  return { ...theme,
    ...(family ? { editorFontFamily: family } : {}),
    ...(typeof size === "number" && Number.isFinite(size) && size >= 11 && size <= 28
      ? { editorFontSize: size } : {}),
  };
}
