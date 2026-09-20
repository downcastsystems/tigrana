// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { bundledThemes } from './bundledThemes';
import { exampleTheme } from './themes.fixture';
import { parseTheme } from './themes';
import { loadThemeCatalog, recoveryTheme } from './themeCatalog';
import { originalSnapshot, updateDerivedTheme } from './themeDerivation';
import { themeVariables, themeStylesheet } from './themeRuntime';
import { parseControls } from './themeOptions';
import { checkTheme } from './themeHealth';
import { defaultThemeDesign } from './themeDesign';
import { decodeThemePackage, encodeThemePackage } from './themePackage';

const original = () => parseTheme({ ...exampleTheme(), schemaVersion: 2, design: defaultThemeDesign });
describe('theme authoring and recovery', () => {
  it('isolates unsupported CSS at startup while retaining working themes and a valid fallback', () => {
    const good = original();
    const invalid = { ...good, id: 'bad', name: 'Broken', design: { ...good.design, css: '.note-row:is(.is-active) { color:red; }' } };
    const result = loadThemeCatalog([invalid, good]);
    expect(result.themes).toEqual([good]);
    expect(result.warnings[0]).toContain('Unsupported pseudo-class');
    expect(() => themeStylesheet(parseTheme(recoveryTheme), 'dark', 'notebook')).not.toThrow();
    expect(loadThemeCatalog([null, {}]).warnings).toHaveLength(2);
  });
  it('rejects duplicate IDs in a catalog', () => {
    const theme = original();
    expect(loadThemeCatalog([theme, theme]).themes).toHaveLength(1);
    expect(loadThemeCatalog([theme, theme]).warnings).toHaveLength(1);
  });
  it('follows font sizes for all small text and selected colors for menus', () => {
    const theme = { ...original(), appFontSize: 20, editorFontSize: 18 };
    const vars = themeVariables(theme, 'dark');
    expect(vars['--tigrana-font-menu']).toBe('20px');
    expect(vars['--tigrana-font-status']).toBe('18px');
    expect(vars['--tigrana-menu-selected-text']).toBe('var(--tigrana-selected-text)');
    expect(themeVariables({ ...theme, typography: { menu: 22 } }, 'dark')['--tigrana-font-menu']).toBe('22px');
  });
  it('preserves new fields and the original across portable exports', () => {
    const base = original();
    const theme = parseTheme({ ...base, id: 'copy', baseThemeId: base.id, baseThemeSnapshot: base,
      typography: { menu: 20 }, controls: [{ id: 'art', label: 'Show art', type: 'toggle', value: false }],
      dark: { ...base.dark, menuSelectedText: '#112233' } });
    expect(decodeThemePackage(encodeThemePackage(theme))).toEqual(theme);
    expect(themeVariables(theme, 'dark')['--tigrana-control-art']).toBe('0');
  });
  it('round trips derived artwork themes within package limits', () => {
    for (const base of bundledThemes) {
      const copy = parseTheme({ ...base, id: 'copy', baseThemeId: base.id, baseThemeSnapshot: base });
      expect(decodeThemePackage(encodeThemePackage(copy))).toEqual(copy);
    }
  });
  it('keeps edited fields and adopts upstream fixes, including CSS and colors', () => {
    const base = original();
    const custom = parseTheme({ ...base, id: 'custom', name: 'My theme', baseThemeId: base.id, baseThemeSnapshot: base, editorFontSize: 20, dark: { ...base.dark, accent: '#123456' } });
    const latest = parseTheme({ ...base, editorFontSize: 19, dark: { ...base.dark, accent: '#654321', text: '#eeeeee' }, design: { ...base.design, css: '.note-tab { border-radius: 12px; }' } });
    const updated = updateDerivedTheme(custom, latest);
    expect(updated.id).toBe('custom'); expect(updated.name).toBe('My theme');
    expect(updated.editorFontSize).toBe(20); expect(updated.dark.accent).toBe('#123456');
    expect(updated.dark.text).toBe('#eeeeee'); expect(updated.design?.css).toBe(latest.design?.css);
    expect(updated.baseThemeSnapshot).toEqual(originalSnapshot(latest));
    expect(updateDerivedTheme(updated, latest)).toEqual(updated);
  });
  it('preserves explicit CSS edits as a whole rather than attempting a text merge', () => {
    const base = original();
    const custom = parseTheme({ ...base, id: 'copy', baseThemeId: base.id, baseThemeSnapshot: base, design: { ...base.design, css: '.note-tab { color: red; }' } });
    const latest = parseTheme({ ...base, design: { ...base.design, css: '.note-tab { color: blue; }' } });
    expect(updateDerivedTheme(custom, latest).design?.css).toBe(custom.design?.css);
  });
  it('merges control values by ID and rejects updates that invalidate a user value', () => {
    const base = parseTheme({ ...original(), controls: [{ id: 'size', label: 'Size', type: 'range', min: 0, max: 20, step: 1, value: 3 }] });
    const custom = parseTheme({ ...base, id: 'copy', baseThemeId: base.id, baseThemeSnapshot: base, controls: [{ ...base.controls![0], value: 15 }] });
    const latest = parseTheme({ ...base, controls: [{ ...base.controls![0], max: 10 }] });
    expect(() => updateDerivedTheme(custom, latest)).toThrow('Invalid size control');
    expect(custom.controls![0].value).toBe(15);
  });
  it('validates role ranges and prevents recursive or mismatched originals', () => {
    const base = original();
    expect(() => parseTheme({ ...base, typography: { status: 5 } })).toThrow();
    expect(() => parseTheme({ ...base, typography: { surprise: 15 } })).toThrow();
    expect(() => parseTheme({ ...base, baseThemeId: 'wrong', baseThemeSnapshot: base })).toThrow();
    expect(() => parseTheme({ ...base, baseThemeId: base.id, baseThemeSnapshot: { ...base, baseThemeId: base.id, baseThemeSnapshot: base } })).toThrow();
  });
  it('validates controls before they become CSS values', () => {
    for (const value of ['red;}', 'url(https://example.com)']) expect(() => parseControls([{ id: 'color', label: 'Color', type: 'color', value }])).toThrow();
    expect(() => parseControls([{ id: 'bad id', label: 'Bad', type: 'toggle', value: true }])).toThrow();
    expect(() => parseControls([{ id: 'size', label: 'Size', type: 'range', min: 0, max: 10, step: 0, value: 3 }])).toThrow();
  });
  it('reports low contrast for both modes without changing the theme', () => {
    const theme = original(); theme.light.text = theme.light.surface; theme.dark.selectedText = theme.dark.accent;
    const before = JSON.stringify(theme);
    expect(checkTheme(theme).warnings.some(w => w.startsWith('light: Interface'))).toBe(true);
    expect(checkTheme(theme).warnings.some(w => w.startsWith('dark: Selected'))).toBe(true);
    expect(JSON.stringify(theme)).toBe(before);
  });
});
