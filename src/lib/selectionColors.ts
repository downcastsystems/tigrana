/** Accent hue with separated lightness levels, so selection readability does
 * not depend on distinguishing hues. These pairs also survive grayscale. */
export function accentSelectionColors(accent: string, mode: 'light' | 'dark') {
  return selectionColors(accent, mode, 2);
}

function selectionColors(accent: string, mode: 'light' | 'dark', version: 0 | 1 | 2) {
  const legacy = version === 0;
  // The reference blue shared by Tigrana and Classic.
  if (['#0056d6', '#245fa5', '#285b99'].includes(accent.toLowerCase())) {
    return mode === 'dark'
      ? { selectionBackground: legacy ? '#032042' : '#103969', selectionText: legacy ? '#6da7ec' : '#9fc9ff' }
      : { selectionBackground: legacy ? '#d2e4fa' : version === 1 ? '#e1edfc' : '#c2dcff', selectionText: legacy ? '#123e73' : version === 1 ? '#20558e' : '#084f9e' };
  }
  const [r, g, b] = [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const hue = delta === 0 ? 0 : 60 * (max === r ? ((g - b) / delta + 6) % 6
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4);
  const color = (l: number, s: number) => {
    const a = s * Math.min(l, 1 - l);
    return '#' + [0, 8, 4].map(n => {
      const k = (n + hue / 30) % 12;
      const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(value * 255).toString(16).padStart(2, '0');
    }).join('');
  };
  return mode === 'dark'
    ? { selectionBackground: color(legacy ? 0.135 : 0.22, Math.min(saturation, legacy ? 0.91 : 0.73)), selectionText: color(legacy ? 0.7 : 0.8, Math.min(saturation, legacy ? 0.77 : 0.85)) }
    : { selectionBackground: color(legacy ? 0.9 : version === 1 ? 0.94 : 0.87, Math.min(saturation, version === 2 ? 0.85 : 0.77)), selectionText: color(legacy ? 0.23 : version === 1 ? 0.24 : 0.20, Math.min(saturation, legacy ? 0.91 : version === 1 ? 0.85 : 0.95)) };
}

/** Upgrade only the previous generated pair in a saved built-in palette. */
export function refreshSelectionColors<T extends { accent: string; selectionBackground?: string; selectionText?: string }>(palette: T, mode: 'light' | 'dark'): T {
  const isPreviousPair = ([0, 1] as const).some(version => {
    const old = selectionColors(palette.accent, mode, version);
    return palette.selectionBackground?.toLowerCase() === old.selectionBackground
      && palette.selectionText?.toLowerCase() === old.selectionText;
  });
  return isPreviousPair
    ? { ...palette, ...accentSelectionColors(palette.accent, mode) }
    : palette;
}
