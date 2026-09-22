import { defaultThemeDesign } from "../lib/themeDesign";
import { resolveTypography, typographyKeys, typographyLabels } from '../lib/themeOptions';
import type { ThemeDocument } from '../lib/themes';
export function ThemeTypographyEditor({ theme, change }: { theme: ThemeDocument; change: (patch: Partial<ThemeDocument>) => void }) {
  const sizes = resolveTypography(theme);
  return <fieldset className="theme-role-settings"><legend>Typography</legend>
    <p>Automatic sizes follow your interface and note font sizes. Set individual sizes for fonts that need more room.</p>
    {typographyKeys.map(key => <label className="setting-row" key={key}>{typographyLabels[key]}
      <input aria-label={`${typographyLabels[key]} size`} type="number" min={11} max={key === 'title' ? 96 : 32} placeholder={`Auto (${Math.round(sizes[key])})`}
        value={theme.typography?.[key] ?? ''} onChange={event => {
          const typography = { ...theme.typography };
          if (!event.target.value) delete typography[key]; else typography[key] = Number(event.target.value);
          change({ typography });
        }} />
    </label>)}
    {([
      { key: 'editorLineHeight', label: 'Line height', value: theme.editorLineHeight ?? theme.design?.metrics.lineHeight ?? defaultThemeDesign.metrics.lineHeight, min: 1.2, max: 2.2, unit: '×' },
      { key: 'editorLetterSpacing', label: 'Letter spacing', value: theme.editorLetterSpacing ?? 0, min: -0.03, max: 0.12, unit: 'em' },
    ] as const).map(({ key, label, value, min, max, unit }) => <label className="setting-row" key={key}>
      {label}
      <span className="theme-spacing-control">
        <input aria-label={label} type="range" min={min} max={max} step={0.01}
          value={value} onChange={event => change({ [key]: Number(event.target.value) })} />
        <output>{value.toFixed(2)}{unit}</output>
      </span>
    </label>)}
    <button type="button" className="toolbar-button" onClick={() => change({ typography: undefined })}>Use automatic text sizes</button>
  </fieldset>;
}
