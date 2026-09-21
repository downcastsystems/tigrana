import { describe, expect, it } from 'vitest';
import { allBuiltInThemes } from './bundledThemes';
import { captureCurrentThemeSettings, hasCurrentThemeChanges } from './currentThemeSettings';
import { defaultPlasmaSettings, parseTheme } from './themes';
import { themeStylesheet } from './themeRuntime';

const defaultTheme = allBuiltInThemes.find(t => t.id === 'default')!;
const settings = { quickAppearance: null, navigationStyle: 'section-view' as const, rightSidebarOpen: true,
  plasma: { ...defaultPlasmaSettings, flow: 0 }, accentTitlebar: false };

describe('saving current appearance as a theme', () => {
  it('ignores identity, equivalent Plasma defaults and unspecified layout defaults', () => {
    const current = captureCurrentThemeSettings(defaultTheme, settings);
    expect(hasCurrentThemeChanges(defaultTheme, { ...current, id: 'draft', name: 'Copy' })).toBe(false);
    expect(hasCurrentThemeChanges({ ...defaultTheme, navigationStyle: undefined, rightSidebarOpen: undefined }, current)).toBe(false);
  });
  it('captures accent, layout, sidebar, and all Plasma settings without mutating the original', () => {
    const source = allBuiltInThemes.find(t => t.id === 'builtin-starfall-studio')!;
    const before = JSON.stringify(source);
    const copy = captureCurrentThemeSettings(source, { ...settings, quickAppearance: { accentColor: '#123456' }, navigationStyle: 'dual-pane', rightSidebarOpen: false,
      plasma: { enabled: true, frost: 35, backgroundBlur: 9, flow: 12 } });
    expect(hasCurrentThemeChanges(source, copy)).toBe(true);
    expect(copy.light.accent).toBe('#123456'); expect(copy.dark.accent).toBe('#123456');
    expect(copy.navigationStyle).toBe('dual-pane'); expect(copy.rightSidebarOpen).toBe(false);
    expect(copy.plasma).toEqual({ enabled: true, frost: 35, backgroundBlur: 9, flow: 12 });
    expect(copy.design).toBe(source.design);
    expect(JSON.stringify(source)).toBe(before);
    expect(() => parseTheme(copy)).not.toThrow();
  });
  it('captures manual writing layout changes and detects departures from theme defaults', () => {
    const source = allBuiltInThemes.find(t => t.id === 'builtin-typewriter')!;
    const copy = captureCurrentThemeSettings(source, { ...settings, navigationStyle: source.navigationStyle!, rightSidebarOpen: false, editorWidthMode: 'full', noteAlignment: 'left', wordCountVisible: false });
    expect(copy.wordCountVisible).toBe(false);
    expect(copy.editorWidthMode).toBe('full');
    expect(copy.noteAlignment).toBe('left');
    expect(hasCurrentThemeChanges(source, copy)).toBe(true);
  });
  it('bakes a quick title bar override above custom CSS while keeping the Default dark-blue titlebar', () => {
    const copy = captureCurrentThemeSettings(defaultTheme, { ...settings, accentTitlebar: true, quickAppearance: { coloredTitlebar: true, accentColor: '#4477cc' } });
    expect(copy.accentTitlebar).toBe(true);
    expect(copy.dark.titlebar).toBe('#001428');
    expect(copy.design?.css).toContain('background: #001428');
    expect(() => themeStylesheet(parseTheme(copy), 'dark', 'notebook')).not.toThrow();
  });
  it('detects a titlebar override even when its palette color matches the original', () => {
    const original = { ...defaultTheme, accentTitlebar: true };
    const copy = captureCurrentThemeSettings(original, { ...settings, accentTitlebar: true, quickAppearance: { accentColor: original.dark.accent } });
    expect(hasCurrentThemeChanges(original, copy)).toBe(true);
  });
  it('preserves an uncolored override and stops reporting changes when choices return to defaults', () => {
    const colored = { ...defaultTheme, accentTitlebar: true };
    const copy = captureCurrentThemeSettings(colored, { ...settings, quickAppearance: { coloredTitlebar: false } });
    expect(copy.design?.css).toContain('background: var(--plasma-titlebar-fill)');
    expect(copy.design?.css).toContain('background: var(--surface)');
    expect(hasCurrentThemeChanges(colored, copy)).toBe(true);
    const restored = captureCurrentThemeSettings(defaultTheme, { ...settings, quickAppearance: { coloredTitlebar: false } });
    expect(hasCurrentThemeChanges(defaultTheme, restored)).toBe(false);
  });
});
