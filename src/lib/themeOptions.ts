/** Stable theme roles. Missing sizes follow the interface or editor size. */
export const typographyKeys = ['title', 'compactTitle', 'navigation', 'tab', 'menu', 'secondary', 'status'] as const;
export type ThemeTypography = Partial<Record<(typeof typographyKeys)[number], number>>;
export const typographyLabels: Record<(typeof typographyKeys)[number], string> = {
  title: 'Note title', compactTitle: 'Compact title', navigation: 'Navigation text', tab: 'Tab text',
  menu: 'Menu labels', secondary: 'Secondary text', status: 'Word count and status',
};
export function resolveTypography(theme: { appFontSize: number; editorFontSize: number; typography?: ThemeTypography }) {
  const app = theme.appFontSize;
  return { title: theme.editorFontSize * 2.47, compactTitle: app, navigation: app, tab: app,
    menu: app, secondary: Math.max(12, app - 2), status: Math.max(12, app - 2), ...theme.typography };
}
export function parseTypography(value: unknown): ThemeTypography {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid typography settings.');
  return Object.fromEntries(Object.entries(value).map(([key, n]) => {
    if (!(typographyKeys as readonly string[]).includes(key) || typeof n !== 'number' || !Number.isFinite(n) || n < 11 || n > (key === 'title' ? 96 : 32))
      throw new Error(`Invalid ${key} typography size.`);
    return [key, n];
  }));
}
export type ThemeControl = {
  id: string; label: string; type: 'range' | 'color' | 'toggle';
  value: number | string | boolean; min?: number; max?: number; step?: number;
};
export function parseControls(value: unknown): ThemeControl[] {
  if (!Array.isArray(value) || value.length > 24) throw new Error('Use at most 24 theme controls.');
  const ids = new Set<string>();
  return value.map(v => {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(v.id) || ids.has(v.id)) throw new Error('Theme controls need unique lowercase IDs.');
    ids.add(v.id);
    if (typeof v.label !== 'string' || !v.label.trim() || v.label.length > 80) throw new Error('Control labels must contain 1–80 characters.');
    const base = { id: v.id, label: v.label.trim() };
    if (v.type === 'toggle' && typeof v.value === 'boolean') return { ...base, type: 'toggle', value: v.value };
    if (v.type === 'color' && typeof v.value === 'string' && /^#[0-9a-f]{6}$/i.test(v.value)) return { ...base, type: 'color', value: v.value.toLowerCase() };
    if (v.type === 'range' && [v.min, v.max, v.step, v.value].every(n => typeof n === 'number' && Number.isFinite(n)) && v.min >= -1000 && v.max <= 1000 && v.max > v.min && v.step > 0 && v.step <= v.max - v.min && v.value >= v.min && v.value <= v.max)
      return { ...base, type: 'range', min: v.min, max: v.max, step: v.step, value: v.value };
    throw new Error(`Invalid ${v.id} control. Ranges need min/max/step and a value within bounds.`);
  });
}
