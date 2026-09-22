import { expect, it } from "vitest";
import { applyQuickAppearanceFonts, quickAppearanceStyles, quickEditorFonts, themeFontLabel } from "./quickAppearance";
import { allBuiltInThemes } from "./bundledThemes";
import { parseTheme } from "./themes";
import { themeStylesheet, themeVariables } from "./themeRuntime";

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

it.each([
  ['theme-font-ibm-plex-mono, monospace', 'IBM Plex Mono'],
  ['theme-font-vt323, monospace', 'VT323'],
  ['theme-font-solway, serif', 'Solway'],
  ['"Source Serif 4", serif', 'Source Serif 4'],
  ['Inter, sans-serif', 'Inter'],
])('names the original theme font %s', (family, label) => {
  expect(themeFontLabel(family)).toBe(label);
});

it('offers every packaged font used by a built-in theme', () => {
  for (const theme of allBuiltInThemes) {
    for (const family of [theme.appFontFamily, theme.editorFontFamily]) {
      if (family.startsWith('theme-font-')) expect(quickEditorFonts.some(font => font.value === family)).toBe(true);
    }
  }
});

it.each(['IBM Plex Mono', 'Solway', 'VT323'])('loads %s offline in every built-in theme without changing the original', label => {
  const font = quickEditorFonts.find(font => font.label === label)!;
  expect(font).toBeDefined();
  for (const original of allBuiltInThemes) {
    const before = JSON.stringify(original);
    const result = applyQuickAppearanceFonts(original, { editorFontFamily: font.value });
    const parsed = parseTheme(result);
    const alias = font.value.split(',')[0].slice('theme-font-'.length);
    expect(parsed.design?.assets[`assets/${alias}.woff2`]?.data).toBeTruthy();
    expect(parsed.design?.license).toContain('SIL OPEN FONT LICENSE');
    expect(themeVariables(parsed, 'dark', 'notebook')['--editor-font-family']).toContain(`tigrana-notebook-${alias}`);
    expect(themeStylesheet(parsed, 'dark', 'notebook')).toContain(`@font-face{font-family:"tigrana-notebook-${alias}"`);
    expect(themeStylesheet(parsed, 'light', 'preview')).toContain(`@font-face{font-family:"tigrana-preview-${alias}"`);
    expect(JSON.stringify(original)).toBe(before);
    expect(applyQuickAppearanceFonts(result, { editorFontFamily: font.value })).toEqual(result);
  }
});

it('preserves an imported font with a colliding filename', () => {
  const solway = quickEditorFonts.find(font => font.label === 'Solway')!;
  const source = allBuiltInThemes.find(theme => theme.editorFontFamily === solway.value)!;
  const other = applyQuickAppearanceFonts(exampleTheme(), { editorFontFamily: 'theme-font-vt323, monospace' }).design!.assets['assets/vt323.woff2'];
  expect(other).toBeDefined();
  const theme = { ...source, design: { ...source.design!, assets: { 'assets/solway.woff2': other } } };
  const result = applyQuickAppearanceFonts(theme, { editorFontFamily: solway.value });
  expect(result.design!.assets['assets/solway.woff2']).toEqual(other);
  expect(result.editorFontFamily).toBe('theme-font-solway-quick-1, Georgia, serif');
  expect(result.design!.assets['assets/solway-quick-1.woff2']).toEqual(source.design!.assets['assets/solway.woff2']);
  expect(applyQuickAppearanceFonts(result, { editorFontFamily: solway.value })).toEqual(result);
  expect(() => parseTheme(result)).not.toThrow();
});

it('preserves spacing through portable theme export and ignores invalid notebook overrides', () => {
  const source = exampleTheme();
  const adjusted = applyQuickAppearanceFonts(source, { editorLineHeight: 1.85, editorLetterSpacing: 0.025 });
  const restored = parseTheme(JSON.parse(JSON.stringify(adjusted)));
  expect(themeVariables(restored, 'dark')['--tigrana-line-height']).toBe('1.85');
  expect(themeVariables(restored, 'dark')['--tigrana-letter-spacing']).toBe('0.025em');
  expect(source.editorLineHeight).toBeUndefined();
  for (const value of [NaN, Infinity, -1, 3]) {
    expect(applyQuickAppearanceFonts(source, { editorLineHeight: value, editorLetterSpacing: value })).toEqual(source);
    expect(() => parseTheme({ ...source, editorLineHeight: value })).toThrow();
    expect(() => parseTheme({ ...source, editorLetterSpacing: value })).toThrow();
  }
});
