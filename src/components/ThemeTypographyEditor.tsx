import { resolveTypography, typographyKeys, typographyLabels } from '../lib/themeOptions';
import type { ThemeDocument } from '../lib/themes';
export function ThemeTypographyEditor({ theme, change }: { theme: ThemeDocument; change: (patch: Partial<ThemeDocument>) => void }) {
  const sizes = resolveTypography(theme);
  return <fieldset className="theme-role-settings"><legend>Text sizes</legend>
    <p>Automatic sizes follow your interface and note font sizes. Set individual sizes for fonts that need more room.</p>
    {typographyKeys.map(key => <label className="setting-row" key={key}>{typographyLabels[key]}
      <input aria-label={`${typographyLabels[key]} size`} type="number" min={11} max={key === 'title' ? 96 : 32} placeholder={`Auto (${Math.round(sizes[key])})`}
        value={theme.typography?.[key] ?? ''} onChange={event => {
          const typography = { ...theme.typography };
          if (!event.target.value) delete typography[key]; else typography[key] = Number(event.target.value);
          change({ typography });
        }} />
    </label>)}
    <button type="button" className="toolbar-button" onClick={() => change({ typography: undefined })}>Use automatic text sizes</button>
  </fieldset>;
}
