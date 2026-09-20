import { useState } from 'react';
import type { ThemeDocument } from '../lib/themes';
import { parseControls, type ThemeControl } from '../lib/themeOptions';
export function ThemeControlsEditor({ theme, change }: { theme: ThemeDocument; change: (patch: Partial<ThemeDocument>) => void }) {
  const [definitions, setDefinitions] = useState<string | null>(null);
  const [error, setError] = useState('');
  const controls = theme.controls ?? [];
  const update = (id: string, value: ThemeControl['value']) => change({ controls: controls.map(c => c.id === id ? { ...c, value } : c) });
  return <fieldset className="theme-role-settings"><legend>Theme-specific controls</legend>
    {controls.map(c => <label className="setting-row" key={c.id}><span>{c.label}</span>
      {c.type === 'range' ? <span className="theme-control-value"><input aria-label={c.label} type="range" min={c.min} max={c.max} step={c.step} value={Number(c.value)} onChange={e => update(c.id, Number(e.target.value))} /><output>{String(c.value)}</output></span>
        : c.type === 'color' ? <input aria-label={c.label} type="color" value={String(c.value)} onChange={e => update(c.id, e.target.value)} />
          : <input aria-label={c.label} type="checkbox" checked={Boolean(c.value)} onChange={e => update(c.id, e.target.checked)} />}
    </label>)}
    <details onToggle={e => { if (e.currentTarget.open) { setDefinitions(JSON.stringify(controls, null, 2)); setError(''); } }}>
      <summary>Define controls for this theme</summary>
      <p>Add color pickers, switches, or sliders. Each ID creates a CSS variable such as <code>--tigrana-control-border-width</code>. Ranges output numbers; use <code>calc(var(--tigrana-control-border-width) * 1px)</code> for lengths. Switches output 1 or 0.</p>
      <button type="button" className="toolbar-button" onClick={() => setDefinitions(JSON.stringify([...controls, { id: `detail-${controls.length + 1}`, label: 'Detail size', type: 'range', min: 0, max: 20, step: 1, value: 3 }], null, 2))}>Start with a slider</button>
      <textarea aria-label="Theme control definitions" className="theme-code" value={definitions ?? ''} onChange={e => setDefinitions(e.target.value)} />
      <button type="button" className="toolbar-button" onClick={() => { try { change({ controls: parseControls(JSON.parse(definitions ?? '[]')) }); setError(''); } catch (e) { setError(String(e)); } }}>Apply control definitions</button>
      {error && <p role="alert">{error}</p>}
    </details>
  </fieldset>;
}
