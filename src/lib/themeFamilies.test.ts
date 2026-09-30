import { expect, it } from 'vitest';
import { allBuiltInThemes, bundledThemes, classicThemes } from './bundledThemes';
import { rememberedThemeColor, themeFamily } from './themeFamilies';
import { resolveThemeVariant } from './themes';
import { contrastRatio } from './themeHealth';

it('defaults Classic to Blue while preserving saved palette IDs', () => {
  const blue = classicThemes.find(theme => theme.id === 'default')!;
  expect(blue.name).toBe('Blue');
  expect(blue.light.accent).toBe('#245fa5');
  expect(blue.dark.accent).toBe('#285b99');
  expect(themeFamily('default')?.colors.map(color => color.name)).toEqual([
    'Blue', 'Gray', 'Green', 'Purple', 'Atom', 'Everforest', 'Gruvbox', 'Nord', 'Solarized',
    'Catppuccin Frappe', 'Catppuccin Latte', 'Catppuccin Macchiato', 'Catppuccin Mocha',
  ]);
  expect(rememberedThemeColor('classic')).toBe('default');
  expect(rememberedThemeColor('classic', { classic: 'missing' })).toBe('default');
  for (const color of themeFamily('default')!.colors) {
    expect(rememberedThemeColor('classic', { classic: color.id })).toBe(color.id);
    expect(classicThemes.find(theme => theme.id === color.id)?.name).toBe(color.name);
  }
});

it('remembers former Catppuccin family colors without replacing a newer Classic choice', () => {
  expect(themeFamily('catppuccin-mocha')?.id).toBe('classic');
  expect(rememberedThemeColor('classic', { catppuccin: 'catppuccin-mocha' })).toBe('catppuccin-mocha');
  expect(rememberedThemeColor('classic', { classic: 'default', catppuccin: 'catppuccin-mocha' })).toBe('default');
});

it.each(['gray', 'green', 'purple'])('adds Based %s accents to Classic without replacing its base palette', id => {
  const based = resolveThemeVariant(bundledThemes.find(theme => theme.name === 'Based')!, id);
  const classic = classicThemes.find(theme => theme.id === `classic-${id}`)!;
  const blue = classicThemes.find(theme => theme.id === 'default')!;
  expect(classic.design?.css).toBe(blue.design?.css);
  for (const mode of ['light', 'dark'] as const) {
    const palette = classic[mode];
    expect(palette.accent).toBe(based[mode].accent);
    expect(palette.selectedText).toBe(based[mode].selectedText);
    for (const key of ['background', 'surface', 'surfaceSoft', 'surfaceStrong', 'surfaceMuted', 'border', 'text', 'textMuted', 'editorText'] as const) {
      expect(palette[key]).toBe(blue[mode][key]);
    }
    if (id !== 'gray') {
      for (const key of ['linkColor', 'selectionBackground', 'selectionText'] as const) expect(palette[key]).toBe(based[mode][key]);
    }
    expect(contrastRatio(palette.selectionText!, palette.selectionBackground!)).toBeGreaterThanOrEqual(4.5);
  }
});

it('removes Minimal from the built-in catalog', () => {
  expect(allBuiltInThemes.some(theme => theme.id === 'builtin-minimal' || theme.name === 'Minimal')).toBe(false);
});
