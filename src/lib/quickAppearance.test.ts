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

import { applyQuickAppearance, mixAccentColor } from './quickAppearance';
import { readableThemeText, themeBackgroundImage } from './themeRuntime';
import { captureCurrentThemeSettings, hasCurrentThemeChanges } from './currentThemeSettings';
import { decodeThemePackage, encodeThemePackage } from './themePackage';
import { resolveThemeVariant, defaultPlasmaSettings } from './themes';

it.each(allBuiltInThemes)('coordinates quick colors and panel opacity in $name without mutating it', source => {
  const before = JSON.stringify(source);
  const quick = { accentColor: '#0056d6', panelOpacity: 42 };
  const rendered = applyQuickAppearance(source, quick);
  expect(() => parseTheme(rendered)).not.toThrow();
  expect(applyQuickAppearance(rendered, quick)).toEqual(rendered);
  for (const mode of ['light', 'dark'] as const) {
    const p = rendered[mode];
    expect(p.accent).toBe(quick.accentColor);
    expect(p.linkColor).toBe(mixAccentColor(quick.accentColor, p.editorText ?? p.text, 0.45));
    expect(p.selectionText).toBe(readableThemeText(p.selectionBackground!, 0.99));
    const css = themeStylesheet(rendered, mode, 'notebook');
    expect(css).toContain(p.linkColor);
    expect(css).toContain(p.selectionBackground);
    expect(css).toContain('42%');
  }
  expect(rendered.surfaces).toMatchObject({ navigation: 42, editor: 42, outline: 42, titlebar: 42 });
  expect(JSON.stringify(source)).toBe(before);
});

it('ignores invalid quick colors, opacity and image data', () => {
  const theme = exampleTheme();
  for (const panelOpacity of [NaN, Infinity, -1, 101]) {
    expect(applyQuickAppearance(theme, { panelOpacity, accentColor: 'red; }' })).toEqual(theme);
  }
  expect(applyQuickAppearance(theme, { backgroundImage: { name: 'bad.png', asset: { mime: 'image/png', data: 'bad!' } } })).toEqual(theme);
});

it('packages a quick background with opacity and the selected Based colors', () => {
  const based = allBuiltInThemes.find(theme => theme.name === 'Based')!;
  const source = resolveThemeVariant(based, 'blue');
  const asset = { mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' };
  const quick = { backgroundImage: { name: 'picture.png', asset }, panelOpacity: 30, accentColor: '#7541c8' };
  const rendered = applyQuickAppearance(source, quick);
  expect(themeBackgroundImage(rendered)).toBe(`data:image/png;base64,${asset.data}`);
  expect(applyQuickAppearance(rendered, quick)).toEqual(rendered);
  const captured = captureCurrentThemeSettings(rendered, { quickAppearance: quick, navigationStyle: 'section-view',
    rightSidebarOpen: true, plasma: defaultPlasmaSettings, accentTitlebar: false });
  const imported = decodeThemePackage(encodeThemePackage(captured));
  expect(imported.dark.accent).toBe('#7541c8');
  expect(imported.dark.selectionBackground).toBe(rendered.dark.selectionBackground);
  expect(themeBackgroundImage(imported)).toBe(themeBackgroundImage(rendered));
  expect(imported.surfaces?.navigation).toBe(30);
  expect(hasCurrentThemeChanges(source, captured)).toBe(true);
  expect(themeBackgroundImage(applyQuickAppearance(source, null))).toBeUndefined();
});

it('offers Based schemes while retaining its neutral default', () => {
  const based = allBuiltInThemes.find(theme => theme.name === 'Based')!;
  expect(based.colorVariants?.map(variant => variant.name)).toEqual(['Gray', 'Blue', 'Green', 'Purple']);
  expect(based.dark.accent).toBe('#393939');
  expect(resolveThemeVariant(based, 'blue').dark.accent).toBe('#0056d6');
});

it('chooses white on dark red and black on a pale selection', () => {
  expect(readableThemeText('#862111')).toBe('#ffffff');
  expect(readableThemeText('#f45b4e')).toBe('#000000');
  expect(readableThemeText('#ffffaa')).toBe('#000000');
});

it('keeps generated selection text above 4.5:1 contrast on light and dark backgrounds', () => {
  const luminance = (channels: number[]) => {
    const linear = channels.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const source = exampleTheme();
  // Cover saturated colors, pale tints, dark shades and the foreground switch.
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const accentColor = '#' + [r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('');
    const theme = applyQuickAppearance(source, { accentColor });
    for (const mode of ['light', 'dark'] as const) {
      const palette = theme[mode];
      const channels = [1, 3, 5].map(index => parseInt(palette.selectionBackground!.slice(index, index + 2), 16));
      for (const underlying of [0, 255]) {
        const background = luminance(channels.map(channel => channel * 0.99 + underlying * 0.01));
        const contrast = palette.selectionText === '#ffffff' ? 1.05 / (background + 0.05) : (background + 0.05) / 0.05;
        expect(contrast, `${accentColor} in ${mode} over ${underlying}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});
