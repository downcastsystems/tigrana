// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  listThemes,
  uniqueThemeName,
  themeDisplayNames,
  opaqueThemeColor,
  parseTheme,
  saveTheme,
  deleteTheme,
  themeAppearance,
  themesMatch,
} from "./themes";
import { exampleTheme } from "./themes.fixture";
beforeEach(() => localStorage.clear());
describe("portable themes", () => {
  it("rejects a shared theme using the reserved Default ID", async () => {
    await expect(saveTheme({ ...exampleTheme(), id: 'default', name: 'Default' }, null)).rejects.toThrow('Default');
    expect((await listThemes()).themes).toHaveLength(0);
  });
  it("keeps a legacy Default library file intact without offering it as a saved theme", async () => {
    const contents = JSON.stringify([{ name: 'default.json', contents: JSON.stringify({ ...exampleTheme(), id: 'default', name: 'Default' }) }]);
    localStorage.setItem('tigrana-shared-themes-v1', contents);
    expect((await listThemes()).themes).toHaveLength(0);
    expect(localStorage.getItem('tigrana-shared-themes-v1')).toBe(contents);
  });
  it("validates and preserves optional writing layout defaults", () => {
    const theme = { ...exampleTheme(), editorWidthMode: "narrow" as const, noteAlignment: "center" as const, wordCountVisible: true };
    expect(parseTheme(theme)).toEqual(theme);
    expect(themeAppearance(theme)).toMatchObject({ editorWidthMode: "narrow", noteAlignment: "center", wordCountVisible: true });
    expect(() => parseTheme({ ...theme, editorWidthMode: "invalid" })).toThrow("Invalid editor width");
    expect(() => parseTheme({ ...theme, noteAlignment: "right" })).toThrow("Invalid note alignment");
    expect(themeAppearance(exampleTheme())).not.toHaveProperty("editorWidthMode");
    expect(themeAppearance(exampleTheme())).not.toHaveProperty("wordCountVisible");
    expect(() => parseTheme({ ...theme, wordCountVisible: "true" })).toThrow("Invalid word count");
    expect(themeAppearance(parseTheme({ ...theme, wordCountVisible: false })).wordCountVisible).toBe(false);
  });
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

it("rejects duplicate names but permits editing the same identity", async () => {
  const theme = exampleTheme();
  await saveTheme(theme, null);
  await expect(saveTheme({ ...theme, id: "other", name: `  ${theme.name.toUpperCase()}  ` }, null)).rejects.toThrow("name already exists");
  await saveTheme({ ...theme, editorFontSize: 19 }, theme);
  expect((await listThemes()).themes).toHaveLength(1);
});
it("allocates unique copy names and distinct legacy labels without changing snapshots", () => {
  const a = { ...exampleTheme(), id: "a", name: "Starfall copy" };
  const b = { ...a, id: "b" };
  const c = { ...a, id: "c", name: "Starfall copy (2)" };
  expect(uniqueThemeName(a.name, [a,c])).toBe("Starfall copy (3)");
  expect(themeDisplayNames([b,c,a])).toEqual({ a: "Starfall copy", b: "Starfall copy (3)", c: "Starfall copy (2)" });
  expect(b.name).toBe(a.name);
  expect(uniqueThemeName("x".repeat(100), [{ ...a, name: "x".repeat(100) }]).length).toBe(100);
});

it("deletes only the reviewed shared copy and rejects stale deletion", async () => {
  const theme = exampleTheme();
  await saveTheme(theme, null);
  const changed = { ...theme, name: "Changed" };
  await saveTheme(changed, theme);
  await expect(deleteTheme(theme)).rejects.toThrow("changed");
  expect((await listThemes()).themes).toEqual([changed]);
  await deleteTheme(changed);
  expect((await listThemes()).themes).toEqual([]);
  expect(JSON.parse(localStorage.getItem("tigrana-shared-themes-v1-trash")!)).toHaveLength(1);
  expect(theme.name).not.toBe(changed.name);
});

it('resets Plasma to the selected theme default, including legacy themes', () => {
  expect(themeAppearance(exampleTheme()).plasma?.enabled).toBe(false);
  const plasma = { enabled: true, frost: 45, backgroundBlur: 7 };
  expect(themeAppearance({ ...exampleTheme(), plasma }).plasma).toEqual(plasma);
  expect(themeAppearance({ ...exampleTheme(), plasma: { ...plasma, enabled: false } }).plasma?.enabled).toBe(false);
});


it("round-trips theme navigation preferences and preserves manual layouts without a preference", async () => {
  for (const navigationStyle of ["dual-pane", "single-pane", "section-view"] as const) {
    localStorage.clear();
    const theme = parseTheme({ ...exampleTheme(), navigationStyle });
    await saveTheme(theme, null);
    expect((await listThemes()).themes[0].navigationStyle).toBe(navigationStyle);
    expect(themeAppearance(theme).navigationStyle).toBe(navigationStyle);
  }
  expect(themeAppearance(exampleTheme())).not.toHaveProperty("navigationStyle");
  expect(parseTheme({ ...exampleTheme(), navigationStyle: undefined })).not.toHaveProperty("navigationStyle");
  expect(() => parseTheme({ ...exampleTheme(), navigationStyle: "invalid" })).toThrow("Invalid navigation style");
});


it("validates and applies optional right sidebar defaults including closed", () => {
  for (const rightSidebarOpen of [true, false]) {
    const theme = parseTheme({ ...exampleTheme(), rightSidebarOpen });
    expect(themeAppearance(theme).rightSidebarOpen).toBe(rightSidebarOpen);
  }
  expect(themeAppearance(exampleTheme())).not.toHaveProperty("rightSidebarOpen");
  expect(() => parseTheme({ ...exampleTheme(), rightSidebarOpen: "closed" })).toThrow("Invalid right sidebar setting");
});


it("round-trips Plasma motion settings and rejects invalid values", async () => {
  const plasma = { enabled: true, frost: 80, backgroundBlur: 0, flow: 65, ambientDrops: true };
  const theme = parseTheme({ ...exampleTheme(), plasma });
  await saveTheme(theme, null);
  expect((await listThemes()).themes[0].plasma?.flow).toBe(65);
  expect(themeAppearance(theme).plasma?.flow).toBe(65);
  expect((await listThemes()).themes[0].plasma?.ambientDrops).toBe(true);
  expect(themeAppearance(theme).plasma?.ambientDrops).toBe(true);
  expect(parseTheme({ ...theme, plasma: { ...plasma, ambientDrops: false } }).plasma?.ambientDrops).toBe(false);
  for (const ambientDrops of [1, "true", null]) {
    expect(() => parseTheme({ ...theme, plasma: { ...plasma, ambientDrops } })).toThrow("Invalid Plasma settings");
  }
  for (const flow of [-1, 101, NaN, "50"]) {
    expect(() => parseTheme({ ...theme, plasma: { ...plasma, flow } })).toThrow("Invalid Plasma settings");
  }
});
