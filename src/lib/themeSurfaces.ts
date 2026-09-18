export const surfaceKeys = ['navigation', 'editor', 'outline', 'titlebar'] as const;
export type ThemeSurfaces = Record<(typeof surfaceKeys)[number], number> & {
  background: string;
  image?: string;
};
export function parseThemeSurfaces(value: unknown): ThemeSurfaces {
  const v = value as ThemeSurfaces | null;
  if (!v || typeof v.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(v.background))
    throw new Error('Invalid surface background. Use #RRGGBB.');
  const result: ThemeSurfaces = { background: v.background.toLowerCase(), navigation: 100, editor: 100, outline: 100, titlebar: 100 };
  for (const key of surfaceKeys) {
    if (typeof v[key] !== 'number' || !Number.isFinite(v[key]) || v[key] < 0 || v[key] > 100)
      throw new Error('Surface opacity must be between 0 and 100.');
    result[key] = v[key];
  }
  if (v.image !== undefined) {
    if (typeof v.image !== 'string' || !/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(v.image))
      throw new Error('Choose a packaged background image.');
    result.image = v.image;
  }
  return result;
}
