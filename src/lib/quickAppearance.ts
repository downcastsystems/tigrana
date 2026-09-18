import type { CSSProperties } from "react";
import type { NotebookAppearance } from "../types";
import { readableThemeText } from "./themeRuntime";

export function quickAppearanceStyles(quick: NotebookAppearance["quickAppearance"], accent: string, colored: boolean, titlebarColor = accent) {
  const palette: Record<string, string> = {};
  if (quick?.accentColor && /^#[0-9a-f]{6}$/i.test(quick.accentColor)) {
    palette["--tigrana-accent"] = quick.accentColor;
    palette["--tigrana-selected-text"] = readableThemeText(quick.accentColor);
    palette["--accent"] = quick.accentColor;
    palette["--accent-active"] = quick.accentColor;
    palette["--accent-contrast"] = readableThemeText(quick.accentColor);
    palette["--accent-soft"] = `color-mix(in srgb, ${quick.accentColor} 25%, transparent)`;
  }
  const titlebar: CSSProperties = quick && (quick.coloredTitlebar !== undefined || quick.accentColor && colored)
    ? { background: colored ? titlebarColor : "var(--surface)", color: colored ? readableThemeText(titlebarColor) : "var(--text)" }
    : {};
  return { palette: palette as CSSProperties, titlebar };
}
