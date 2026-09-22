import { expect, it } from "vitest";
import { themeDefaultsPatch } from "./themeDefaults";
import { exampleTheme } from "./themes.fixture";
import { themeAppearance } from "./themes";
import { classicThemes } from "./bundledThemes";
const theme = { ...exampleTheme(), navigationStyle: "section-view" as const, rightSidebarOpen: true,
  editorWidthMode: "comfortable" as const, noteAlignment: "center" as const, wordCountVisible: true };
it("keeps Default a built-in preset when restoring all defaults", () => {
  const patch = themeDefaultsPatch(classicThemes.find(theme => theme.id === 'default')!, 'all');
  expect(patch.customTheme).toBeNull();
  expect(patch.themePresetId).toBe('default');
});
it("restores all author defaults and clears quick overrides", () => {
  expect(themeDefaultsPatch(theme, "all")).toEqual({ ...themeAppearance(theme), quickAppearance: null });
});
it("limits fonts and colors to appearance fields", () => {
  const patch = themeDefaultsPatch(theme, "appearance");
  expect(patch.quickAppearance).toBeNull();
  expect(patch.editorFontFamily).toBe(theme.editorFontFamily);
  expect(patch.editorFontSize).toBe(theme.editorFontSize);
  expect(patch.colors?.dark?.accentColor).toBe(theme.dark.accent);
  for (const field of ["navigationStyle", "rightSidebarOpen", "editorWidthMode", "noteAlignment", "wordCountVisible", "plasma", "customTheme"]) expect(patch).not.toHaveProperty(field);
});
it("restores all defined layout options without changing colors or fonts", () => {
  expect(themeDefaultsPatch(theme, "layout")).toEqual({ navigationStyle: "section-view", rightSidebarOpen: true,
    editorWidthMode: "comfortable", noteAlignment: "center", wordCountVisible: true });
  expect(themeDefaultsPatch({ ...theme, navigationStyle: undefined, rightSidebarOpen: undefined, editorWidthMode: undefined, noteAlignment: undefined, wordCountVisible: undefined }, "layout")).toEqual({});
});
