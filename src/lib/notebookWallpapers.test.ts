import { expect, it } from 'vitest';
import { notebookWallpapers } from './notebookWallpapers';

it('retains earlier wallpapers and embeds new ones without duplicating renamed uploads', () => {
  const first = { name: 'first.png', asset: { mime: 'image/png', data: 'first-image-bytes' } };
  const second = { name: 'second.png', asset: { mime: 'image/png', data: 'second-image-bytes' } };
  const saved = [first];
  const result = notebookWallpapers(saved, { ...first, name: 'renamed.png' }, second);
  expect(saved).toEqual([first]);
  expect(result).toEqual([first, second]);
  expect(notebookWallpapers(JSON.parse(JSON.stringify(result)), undefined)).toEqual([first, second]);
});

import { wallpaperDeletionReason } from './notebookWallpapers';
import { exampleTheme } from './themes.fixture';
import { defaultThemeDesign } from './themeDesign';

it('protects image data embedded in a theme, even with a different filename', () => {
  const wallpaper = { name: 'renamed.png', asset: { mime: 'image/png', data: 'image-bytes' } };
  const theme = { ...exampleTheme(), design: { ...defaultThemeDesign, assets: { 'assets/original.png': wallpaper.asset } } };
  expect(wallpaperDeletionReason(wallpaper, [theme])).toBe('In use in a custom theme.');
  expect(wallpaperDeletionReason(wallpaper, [{ ...exampleTheme(), baseThemeSnapshot: theme }])).toBe('In use in a custom theme.');
  expect(wallpaperDeletionReason(wallpaper, [], wallpaper)).toContain('Currently used');
  expect(wallpaperDeletionReason(wallpaper, [])).toBeUndefined();
});
