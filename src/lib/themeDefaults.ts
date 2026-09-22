import type { NotebookAppearance } from "../types";
import { themeAppearance, type ThemeDocument } from "./themes";

export type ThemeDefaultsScope = "all" | "appearance" | "layout";

/** Restore only the requested defaults, leaving unrelated notebook choices intact. */
export function themeDefaultsPatch(theme: ThemeDocument, scope: ThemeDefaultsScope): Partial<NotebookAppearance> {
  const appearance = themeAppearance(theme);
  if (scope === "all") return { ...appearance, quickAppearance: null,
    ...(theme.id === "default" ? { customTheme: null, themePresetId: "default" } : {}) };
  if (scope === "appearance") {
    const { colors, appFontFamily, appFontSize, editorFontFamily, editorFontSize } = appearance;
    return { quickAppearance: null, colors, appFontFamily, appFontSize, editorFontFamily, editorFontSize };
  }
  return {
    ...(theme.navigationStyle === undefined ? {} : { navigationStyle: theme.navigationStyle }),
    ...(theme.rightSidebarOpen === undefined ? {} : { rightSidebarOpen: theme.rightSidebarOpen }),
    ...(theme.editorWidthMode === undefined ? {} : { editorWidthMode: theme.editorWidthMode }),
    ...(theme.noteAlignment === undefined ? {} : { noteAlignment: theme.noteAlignment }),
    ...(theme.wordCountVisible === undefined ? {} : { wordCountVisible: theme.wordCountVisible }),
  };
}
