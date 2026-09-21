import { expect, it } from "vitest";
import { applyQuickAppearanceFonts, quickAppearanceStyles } from "./quickAppearance";

it.each([true, false])("ignores a retired title-bar override of %s", (coloredTitlebar) => {
  const legacy = { coloredTitlebar, accentColor: "#123456" };
  expect(quickAppearanceStyles(legacy, false, "#123456").titlebar).toEqual({});
  expect(quickAppearanceStyles(legacy, true, "#123456").titlebar.background).toBe("#123456");
});

it("retains accent overrides without covering an uncolored theme title bar", () => {
  const result = quickAppearanceStyles({ accentColor: "#123456" }, false, "#123456");
  expect(result.titlebar).toEqual({});
  expect(result.palette).toHaveProperty("--accent", "#123456");
});

it("leaves the original title bar alone without a valid accent override", () => {
  expect(quickAppearanceStyles(null, true, "#5c0700").titlebar).toEqual({});
  expect(quickAppearanceStyles({ accentColor: "invalid" }, true, "#5c0700").titlebar).toEqual({});
});

import { exampleTheme } from "./themes.fixture";

it("ignores unsafe families and out-of-range font sizes from notebook metadata", () => {
  const theme = exampleTheme();
  for (const editorFontSize of [NaN, Infinity, 0, 29]) {
    const result = applyQuickAppearanceFonts(theme, { editorFontFamily: "serif;}body{color:red", editorFontSize });
    expect(result).toEqual(theme);
  }
});

it("applies valid quick fonts without changing the original theme", () => {
  const theme = exampleTheme();
  const original = structuredClone(theme);
  const result = applyQuickAppearanceFonts(theme, { editorFontFamily: "Georgia, serif", editorFontSize: 22 });
  expect(result.editorFontFamily).toBe("Georgia, serif");
  expect(result.editorFontSize).toBe(22);
  expect(theme).toEqual(original);
  expect(applyQuickAppearanceFonts(theme, null)).toEqual(original);
});
