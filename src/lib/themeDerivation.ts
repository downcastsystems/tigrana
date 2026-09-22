import { parseTheme, type ThemeDocument } from './themes';

/** A single immutable baseline makes the effective document portable and updates deterministic. */
export function originalSnapshot(theme: ThemeDocument): ThemeDocument {
  const copy = { ...theme };
  delete copy.baseThemeSnapshot;
  delete copy.baseThemeId;
  return parseTheme(copy);
}
/** Legacy copies may name an original without carrying its historical snapshot. */
export function authoringOriginal(theme: ThemeDocument, available: ThemeDocument[]): ThemeDocument {
  return theme.baseThemeSnapshot ?? originalSnapshot(available.find(candidate => candidate.id === theme.baseThemeId) ?? theme);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function equal(a: unknown, b: unknown): boolean {
  if (record(a) && record(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(key => equal(a[key], b[key]));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
/** Three-way merge: unchanged fields follow the new original; explicit edits win. */
function rebase(old: unknown, edited: unknown, latest: unknown): unknown {
  if (equal(old, edited)) return latest;
  if (record(old) && record(edited) && record(latest)) {
    return Object.fromEntries([...new Set([...Object.keys(old), ...Object.keys(edited), ...Object.keys(latest)])]
      .map(key => [key, rebase(old[key], edited[key], latest[key])])
      .filter(([, value]) => value !== undefined));
  }
  return edited;
}
export function updateDerivedTheme(theme: ThemeDocument, latest: ThemeDocument): ThemeDocument {
  if (!theme.baseThemeSnapshot || theme.baseThemeId !== latest.id) throw new Error('This theme has no matching original snapshot.');
  const baseline = originalSnapshot(latest);
  const merged = rebase(theme.baseThemeSnapshot, originalSnapshot(theme), baseline) as ThemeDocument;
  // Merge controls by stable ID, so changing a slider does not freeze all definitions.
  if (theme.controls !== undefined) {
    const oldControls = theme.baseThemeSnapshot.controls ?? [];
    const latestControls = baseline.controls ?? [];
    const ids = new Set([...latestControls, ...theme.controls].map(c => c.id));
    merged.controls = [...ids].flatMap(id => {
      const control = rebase(oldControls.find(c => c.id === id), theme.controls?.find(c => c.id === id), latestControls.find(c => c.id === id));
      return control === undefined ? [] : [control as NonNullable<ThemeDocument['controls']>[number]];
    });
  }
  return parseTheme({ ...merged, id: theme.id, name: theme.name, baseThemeId: baseline.id, baseThemeSnapshot: baseline });
}
