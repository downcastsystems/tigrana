import { parseTheme, type ThemeDocument } from './themes';
import { readableThemeText } from './themeRuntime';
import { resolveTypography } from './themeOptions';
export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export function checkTheme(theme: ThemeDocument): { errors: string[]; warnings: string[] } {
  try { parseTheme(theme); } catch (e) { return { errors: [e instanceof Error ? e.message : String(e)], warnings: [] }; }
  const warnings: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const p = theme[mode], selected = p.selectedText ?? readableThemeText(p.accent);
    const pairs = [
      ['Note text', p.editorText ?? p.text, p.background], ['Interface text', p.text, p.surface], ['Secondary text', p.textMuted, p.surface],
      ['Selected items', selected, p.accent], ['Selected menu items', p.menuSelectedText ?? (p.menuSelectedBackground ? readableThemeText(p.menuSelectedBackground) : selected), p.menuSelectedBackground ?? p.accent],
      ['Hovered items', p.hoverText ?? (p.hoverBackground ? readableThemeText(p.hoverBackground) : selected), p.hoverBackground ?? p.accent],
      ['Highlighted text', p.highlightText ?? '#000000', p.highlightBackground ?? '#ffff00'],
    ];
    for (const [name, foreground, background] of pairs) {
      const ratio = contrastRatio(foreground, background);
      if (ratio < 4.5) warnings.push(`${mode}: ${name} contrast is ${ratio.toFixed(3)}:1; aim for at least 4.5:1 for normal text.`);
    }
  }
  for (const [role, size] of Object.entries(resolveTypography(theme))) if (size < 12) warnings.push(`${role} text is ${size}px. Check its readability at normal zoom.`);
  if (theme.surfaces && ['navigation', 'editor', 'outline', 'titlebar'].some(key => Number(theme.surfaces![key as keyof typeof theme.surfaces]) < 100)) warnings.push('Transparent panels: check readability over the actual background. Palette contrast alone cannot assess images or Plasma effects.');
  if (theme.design?.css) warnings.push('Custom CSS can override these colors and sizes. Inspect the preview, including hover and focus states.');
  return { errors: [], warnings };
}
