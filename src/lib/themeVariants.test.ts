import { describe, expect, it } from 'vitest';
import { classicThemes } from './bundledThemes';
import { parseTheme, resolveThemeVariant, themesMatch } from './themes';
import { decodeThemePackage, encodeThemePackage } from './themePackage';

const base = classicThemes[0];
const theme = { ...base, colorVariants: [
  { id: 'original', name: 'Original', light: base.light, dark: base.dark },
  { id: 'ocean', name: 'Ocean', light: { ...base.light, accent: '#123456' }, dark: { ...base.dark, accent: '#abcdef' } },
], defaultColorVariantId: 'original' };

describe('portable color variants', () => {
  it('exports every palette, keeps shared typography, and does not mutate the source on selection', () => {
    const imported = decodeThemePackage(encodeThemePackage(theme));
    expect(imported).toEqual(parseTheme(theme));
    const selected = resolveThemeVariant(imported, 'ocean');
    expect(selected.light.accent).toBe('#123456');
    expect(selected.dark.accent).toBe('#abcdef');
    expect(selected.editorFontFamily).toBe(base.editorFontFamily);
    expect(imported.light).toEqual(base.light);
    expect(themesMatch(imported, selected)).toBe(true);
  });
  it('uses the default for missing or deleted notebook selections and mirrors it for older readers', () => {
    const changed = parseTheme({ ...theme, defaultColorVariantId: 'ocean' });
    expect(changed.light.accent).toBe('#123456');
    expect(resolveThemeVariant(changed, 'deleted').dark.accent).toBe('#abcdef');
    expect(resolveThemeVariant(base, 'missing')).toBe(base);
  });
  it('rejects duplicate names, IDs, invalid colors and dangling defaults', () => {
    expect(() => parseTheme({ ...theme, defaultColorVariantId: 'missing' })).toThrow();
    expect(() => parseTheme({ ...theme, colorVariants: [theme.colorVariants[0], theme.colorVariants[0]] })).toThrow();
    expect(() => parseTheme({ ...theme, colorVariants: [theme.colorVariants[0], { ...theme.colorVariants[1], name: ' original ' }] })).toThrow();
    expect(() => parseTheme({ ...theme, colorVariants: [{ ...theme.colorVariants[0], dark: { ...base.dark, accent: 'url(bad)' } }] })).toThrow();
  });
});
