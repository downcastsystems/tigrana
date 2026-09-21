import { expect, it } from "vitest";
import { quickAppearanceStyles } from "./quickAppearance";

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
