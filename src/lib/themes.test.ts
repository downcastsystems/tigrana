// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  listThemes,
  opaqueThemeColor,
  parseTheme,
  saveTheme,
  themeAppearance,
  themesMatch,
} from "./themes";
import { exampleTheme } from "./themes.fixture";
beforeEach(() => localStorage.clear());
describe("portable themes", () => {
  it("preserves the appearance of translucent legacy colors when creating a theme", () => {
    expect(opaqueThemeColor("rgba(255, 255, 255, 0.1)", "#000000")).toBe(
      "#1a1a1a",
    );
    expect(opaqueThemeColor("#abcdef", "#000000")).toBe("#abcdef");
  });
  it("round-trips every appearance setting through the shared library", async () => {
    const theme = exampleTheme();
    await saveTheme(theme, null);
    expect(await listThemes()).toEqual({ themes: [theme], warnings: [] });
  });
  it("normalizes key order, color case, and whitespace when comparing", () => {
    const a = exampleTheme();
    expect(
      themesMatch(a, {
        ...a,
        name: " Example ",
        dark: { ...a.dark, accent: "#112233" },
      }),
    ).toBe(true);
    expect(themesMatch(a, { ...a, editorFontSize: 20 })).toBe(false);
  });
  it("rejects unsafe paths, CSS, incomplete palettes, unsupported versions and invalid sizes", () => {
    for (const patch of [
      { id: "../../outside" },
      { schemaVersion: 2 },
      { name: " " },
      { editorFontFamily: "url(http://bad);" },
      { appFontSize: Infinity },
      { dark: {} },
      { dark: { ...exampleTheme().dark, accent: "red" } },
    ]) {
      expect(() => parseTheme({ ...exampleTheme(), ...patch })).toThrow();
    }
  });
  it("rejects stale writes without damaging the shared copy", async () => {
    const a = exampleTheme(),
      b = { ...a, name: "Updated" };
    await saveTheme(a, null);
    await saveTheme(b, a);
    await expect(saveTheme(a, a)).rejects.toThrow("changed");
    await expect(saveTheme(a, null)).rejects.toThrow("changed");
    expect((await listThemes()).themes).toEqual([b]);
  });
  it("isolates malformed files while keeping valid themes available", async () => {
    await saveTheme(exampleTheme(), null);
    const files = JSON.parse(localStorage.getItem("tigrana-shared-themes-v1")!);
    localStorage.setItem(
      "tigrana-shared-themes-v1",
      JSON.stringify([...files, { name: "broken.json", contents: "{" }]),
    );
    const result = await listThemes();
    expect(result.themes).toHaveLength(1);
    expect(result.warnings[0]).toContain("broken.json");
  });
});

it("preserves Plasma settings in JSON and detects differences while accepting legacy themes", async () => {
  const legacy = exampleTheme();
  expect(parseTheme(legacy).plasma).toBeUndefined();
  const theme = {
    ...legacy,
    plasma: { enabled: true, frost: 60, backgroundBlur: 12 },
  };
  await saveTheme(theme, null);
  expect((await listThemes()).themes[0]).toEqual(theme);
  expect(
    themeAppearance(parseTheme(JSON.parse(JSON.stringify(theme)))).plasma,
  ).toEqual(theme.plasma);
  expect(
    themesMatch(theme, {
      ...theme,
      plasma: { ...theme.plasma, enabled: false },
    }),
  ).toBe(false);
  for (const plasma of [
    null,
    {},
    { ...theme.plasma, frost: 101 },
    { ...theme.plasma, backgroundBlur: -1 },
    { ...theme.plasma, enabled: "true" },
  ]) {
    expect(() => parseTheme({ ...theme, plasma })).toThrow();
  }
});
