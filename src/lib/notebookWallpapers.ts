import type { NotebookWallpaper } from '../types';

/** Keep image bytes inside notebook metadata and avoid saving duplicate uploads. */
export function notebookWallpapers(saved: NotebookWallpaper[] = [], ...images: (NotebookWallpaper | undefined)[]): NotebookWallpaper[] {
  const result = [...saved];
  for (const image of images) {
    if (image && !result.some(item => item.asset.mime === image.asset.mime && item.asset.data === image.asset.data)) {
      result.push(image);
    }
  }
  return result;
}

export function sameWallpaper(a: NotebookWallpaper, b: NotebookWallpaper): boolean {
  return a.asset.mime === b.asset.mime && a.asset.data === b.asset.data;
}

export function wallpaperDeletionReason(wallpaper: NotebookWallpaper, themes: import('./themes').ThemeDocument[], active?: NotebookWallpaper): string | undefined {
  const contains = (theme: import('./themes').ThemeDocument): boolean =>
    Object.values(theme.design?.assets ?? {}).some(asset => asset.mime === wallpaper.asset.mime && asset.data === wallpaper.asset.data)
    || !!(theme.baseThemeSnapshot && contains(theme.baseThemeSnapshot));
  if (themes.some(contains)) return 'In use in a custom theme.';
  if (active && sameWallpaper(wallpaper, active)) return "Currently used as this notebook’s background.";
  return undefined;
}
