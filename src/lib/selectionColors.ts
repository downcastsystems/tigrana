/** Accent hue with separated lightness levels, so selection readability does
 * not depend on distinguishing hues. These pairs also survive grayscale. */
export function accentSelectionColors(accent: string, mode: 'light' | 'dark') {
  // The reference blue shared by Based and Classic.
  if (['#0056d6', '#245fa5', '#285b99'].includes(accent.toLowerCase())) {
    return mode === 'dark'
      ? { selectionBackground: '#032042', selectionText: '#6da7ec' }
      : { selectionBackground: '#d2e4fa', selectionText: '#123e73' };
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
    ? { selectionBackground: color(0.135, Math.min(saturation, 0.91)), selectionText: color(0.7, Math.min(saturation, 0.77)) }
    : { selectionBackground: color(0.9, Math.min(saturation, 0.77)), selectionText: color(0.23, Math.min(saturation, 0.91)) };
}
