import { expect, it } from "vitest";
import { quickAppearanceStyles } from "./quickAppearance";

it("restores the original title bar after toggling coloring on and off", () => {
  const options = { themeColored: false, plasma: true };
  const original = quickAppearanceStyles(null, "#5c0700", false, "#5c0700", options);
  expect(quickAppearanceStyles({ coloredTitlebar: true }, "#5c0700", true, "#5c0700", options).titlebar.background).toBe("#5c0700");
  expect(quickAppearanceStyles({ coloredTitlebar: false }, "#5c0700", false, "#5c0700", options).titlebar).toEqual(original.titlebar);
});

it("retains accent overrides while restoring the theme title bar", () => {
  const result = quickAppearanceStyles({ accentColor: "#123456", coloredTitlebar: false }, "#123456", false, "#123456", { themeColored: false, plasma: true });
  expect(result.titlebar).toEqual({});
  expect(result.palette).toHaveProperty("--accent", "#123456");
});


it("uses translucent Plasma when disabling an originally colored title bar", () => {
  expect(quickAppearanceStyles({ coloredTitlebar: false }, "#5c0700", false, "#5c0700", { themeColored: true, plasma: true }).titlebar.background).toBe("var(--plasma-titlebar-fill)");
  expect(quickAppearanceStyles({ coloredTitlebar: true }, "#5c0700", true, "#5c0700", { themeColored: true, plasma: true }).titlebar).toEqual({});
});
