// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { allBuiltInThemes, bundledThemes, classicThemes, builtInThemeDocuments, themeCatalogWarnings } from './bundledThemes';
import { parseTheme, themeAppearance } from './themes';
import { themeStylesheet, readableThemeText } from './themeRuntime';
import { encodeThemePackage, decodeThemePackage } from './themePackage';

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}
describe('built-in theme catalog', () => {
  it('strictly validates every source package even when runtime recovery skips one', () => {
    expect(themeCatalogWarnings).toEqual([]);
    for (const document of builtInThemeDocuments) expect(() => parseTheme(document)).not.toThrow();
  });
  it('retains legacy IDs and has unique names and IDs', () => {
    expect(classicThemes.map(t => t.id)).toEqual(['default', 'atom', 'solarized', 'dracula', 'nord', 'gruvbox', 'catppuccin-frappe', 'catppuccin-macchiato', 'catppuccin-mocha']);
    expect(new Set(allBuiltInThemes.map(t => t.id)).size).toBe(allBuiltInThemes.length);
    expect(new Set(allBuiltInThemes.map(t => t.name)).size).toBe(allBuiltInThemes.length);
    expect(bundledThemes.map(t => t.name)).toEqual(['Minimal', 'Cupertino', 'Baseline', 'Starfall', 'Old Basement PC', 'Adventure Quest', 'Typewriter']);
  });
  for (const theme of allBuiltInThemes) {
    it(`${theme.name} validates, exports, and renders in both modes`, () => {
      expect(parseTheme(theme)).toEqual(theme);
      expect(theme.schemaVersion).toBe(2);
      expect(themeAppearance(theme).rightSidebarOpen).toBe(!["builtin-minimal", "builtin-baseline", "builtin-typewriter"].includes(theme.id));
      expect(themeAppearance(theme).navigationStyle).toBe(["builtin-minimal", "builtin-baseline", "builtin-old-basement-pc"].includes(theme.id) ? "single-pane" : "section-view");
      expect(decodeThemePackage(encodeThemePackage(theme))).toEqual(theme);
      expect(themeAppearance(theme).plasma?.enabled).toBe(theme.plasma?.enabled);
      for (const mode of ['light', 'dark'] as const) {
        const p = theme[mode];
        expect(contrast(p.editorText ?? p.text, p.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.selectedText ?? readableThemeText(p.accent), p.accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.highlightText ?? '#000000', p.highlightBackground ?? '#ffff00')).toBeGreaterThanOrEqual(4.5);
        for (const plasma of [false, true]) {
          const copy = { ...theme, plasma: { ...theme.plasma!, enabled: plasma } };
          const notebook = themeStylesheet(copy, mode, 'notebook');
          const preview = themeStylesheet(copy, mode, 'preview');
          expect(preview.split('preview').join('notebook')).toBe(notebook);
          expect(notebook).toContain(`--tigrana-editor-text:${p.editorText}`);
        }
      }
    });
  }
  it.each([
    ['builtin-old-basement-pc', 'vt323', 'monospace'],
    ['builtin-typewriter', 'solway', 'Georgia, serif'],
  ])('%s resolves packaged fonts in both preview and notebook without external requests', (id, font, fallback) => {
    const theme = bundledThemes.find(t => t.id === id)!;
    for (const region of ['preview', 'notebook']) {
      const css = themeStylesheet(theme, 'dark', region);
      expect(css).toContain(`--editor-font-family:tigrana-${region}-${font}, ${fallback}`);
      expect(css).toContain(`font-family:"tigrana-${region}-${font}"`);
      expect(css).toContain('data:font/woff2;base64,');
    }
  });
  it('picks readable automatic foregrounds on pale and dark accents', () => {
    for (const color of ['#bd93f9', '#ca9ee6', '#61afef', '#285b99', '#600900']) {
      expect(contrast(color, readableThemeText(color))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
