import { defaultTheme } from "./bundledThemes";
import { resolveThemeVariant, themeAppearance } from "./themes";
import type { NotebookAppearance } from "../types";

export function newNotebookAppearance(): NotebookAppearance {
  return {
    ...themeAppearance(resolveThemeVariant(defaultTheme, "blue")),
    themePresetId: defaultTheme.id,
    themeColorPreferences: { [defaultTheme.id]: "blue" },
    colorScheme: "system",
  };
}
