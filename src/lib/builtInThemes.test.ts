// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { allBuiltInThemes, bundledThemes, classicThemes, builtInThemeDocuments, themeCatalogWarnings } from './bundledThemes';
import { parseTheme, themeAppearance, themesMatch } from './themes';
import { themeStylesheet, readableThemeText, themeRenderingMode } from './themeRuntime';
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
  it.each(['dracula', 'plasma-ooze', 'plasma-undertow', 'plasma-witches-brew'])('keeps %s identical in light and dark mode, including Plasma lighting', (id) => {
    const vampire = classicThemes.find(theme => theme.id === id)!;
    expect(vampire.light).toEqual(vampire.dark);
    expect(themeStylesheet(vampire, 'light', 'notebook')).toBe(themeStylesheet(vampire, 'dark', 'notebook'));
    expect(themeRenderingMode(vampire, 'light')).toBe('dark');
    expect(themeRenderingMode(vampire, 'dark')).toBe('dark');
    for (const theme of allBuiltInThemes.filter(theme => theme.id !== 'dracula' && !theme.id.startsWith('plasma-'))) {
      expect(themeRenderingMode(theme, 'light')).toBe('light');
      expect(themeRenderingMode(theme, 'dark')).toBe('dark');
    }
  });

  it('offers four Catppuccin flavors with official light and dark bases and distinct accents', () => {
    const expected = [
      ['catppuccin-latte', '#303446', '#8caaee', '#1e66f5'],
      ['catppuccin-frappe', '#303446', '#a6d189', '#40a02b'],
      ['catppuccin-macchiato', '#24273a', '#f5a97f', '#fe640b'],
      ['catppuccin-mocha', '#1e1e2e', '#cba6f7', '#8839ef'],
    ];
    expect(classicThemes.filter(t => t.id.startsWith('catppuccin-'))).toHaveLength(4);
    for (const [id, background, darkAccent, lightAccent] of expected) {
      const theme = classicThemes.find(t => t.id === id)!;
      expect(theme.light.background).toBe('#eff1f5');
      expect(theme.light.surface).toBe('#e6e9ef');
      expect(theme.light.editorText).toBe('#4c4f69');
      expect(theme.light.accent).toBe(lightAccent);
      expect(theme.dark.background).toBe(background);
      expect(theme.dark.accent).toBe(darkAccent);
    }
  });
  it('gives refreshed palette themes readable hover/menu states and themed highlights', () => {
    const themes = classicThemes.filter(t => t.id.startsWith('catppuccin-') || ['nord', 'gruvbox', 'solarized', 'atom', 'everforest'].includes(t.id));
    for (const theme of themes) {
      expect(theme.plasma?.enabled).toBe(false);
      for (const mode of ['light', 'dark'] as const) {
        const p = theme[mode];
        expect(p.highlightBackground).not.toBe('#ffff00');
        expect(contrast(p.menuSelectedText!, p.menuSelectedBackground!), `${theme.name} ${mode} menu`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.hoverText!, p.hoverBackground!), `${theme.name} ${mode} hover`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('ships reviewed redistribution notices for every bundled theme font', () => {
    const reviewedFonts: Record<string, string> = {
      'assets/ibm-plex-mono.woff2': 'IBM-Plex-Mono',
      'assets/solway.woff2': 'Solway',
      'assets/vt323.woff2': 'VT323',
      'assets/geist-pixel-square.woff2': 'Geist-Pixel',
    };
    for (const theme of allBuiltInThemes) {
      for (const [path, asset] of Object.entries(theme.design?.assets ?? {})) {
        if (!asset.mime.startsWith('font/')) continue;
        const name = reviewedFonts[path];
        expect(name, `Review redistribution rights for ${theme.name}: ${path}`).toBeDefined();
        const notice = readFileSync(`public/licenses/${name}-OFL.txt`, 'utf8').trim();
        expect(notice).toContain('Copyright');
        expect(notice).toContain('SIL OPEN FONT LICENSE Version 1.1');
        expect(theme.design?.license).toContain(notice);
      }
    }
    expect(readFileSync('public/licenses/Inter-OFL.txt', 'utf8')).toBe(
      readFileSync('node_modules/@fontsource-variable/inter/LICENSE', 'utf8'),
    );
  });
  it('strictly validates every source package even when runtime recovery skips one', () => {
    expect(themeCatalogWarnings).toEqual([]);
    for (const document of builtInThemeDocuments) expect(() => parseTheme(document)).not.toThrow();
  });
  it('retains legacy IDs and has unique names and IDs', () => {
    expect(classicThemes.map(t => t.id)).toEqual(['default', 'atom', 'solarized', 'nord', 'gruvbox', 'everforest', 'catppuccin-frappe', 'catppuccin-macchiato', 'catppuccin-mocha', 'catppuccin-latte', 'dracula', 'plasma-ooze', 'plasma-undertow', 'plasma-witches-brew']);
    expect(new Set(allBuiltInThemes.map(t => t.id)).size).toBe(allBuiltInThemes.length);
    expect(new Set(allBuiltInThemes.map(t => t.name)).size).toBe(allBuiltInThemes.length);
    expect(bundledThemes.map(t => t.name)).toEqual(['Minimal', 'Saratoga', 'Based', 'Starfall', 'Old Basement PC', 'Quest', 'Twain']);
  });
  for (const theme of allBuiltInThemes) {
    it(`${theme.name} validates, exports, and renders in both modes`, () => {
      expect(parseTheme(theme)).toEqual(theme);
      const nativeSnapshot = JSON.parse(JSON.stringify(theme, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));
      expect(themesMatch(theme, nativeSnapshot)).toBe(true);
      expect(themesMatch(theme, { ...nativeSnapshot, editorFontSize: theme.editorFontSize + 1 })).toBe(false);
      expect(theme.schemaVersion).toBe(2);
      expect(themeAppearance(theme).rightSidebarOpen).toBe(theme.id === "builtin-minimal" ? false : undefined);
      expect(themeAppearance(theme).navigationStyle).toBe("section-view");
      expect(themeAppearance(theme)).not.toHaveProperty("editorWidthMode");
      expect(themeAppearance(theme)).not.toHaveProperty("noteAlignment");
      expect(themeAppearance(theme)).not.toHaveProperty("wordCountVisible");
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
    ['builtin-old-basement-pc', 'ibm-plex-mono', 'monospace'],
    ['builtin-8-bit-adventure', 'geist-pixel-square', 'monospace'],
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
