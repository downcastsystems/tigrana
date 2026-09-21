import type { CSSProperties } from "react";
import type { NotebookAppearance } from "../types";
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
