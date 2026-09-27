import { useEffect, useRef, useState } from 'react';
import { defaultPlasmaSettings, type ThemeDocument } from '../lib/themes';
import { defaultThemeDesign, parseThemeDesign } from '../lib/themeDesign';
import { surfacesForMode, surfaceKeys } from '../lib/themeSurfaces';
import { ThemeColorField } from './ThemeColorField';

export function ThemeSurfacesEditor({ theme, mode, change }: {
  theme: ThemeDocument; mode: 'light' | 'dark'; change: (patch: Partial<ThemeDocument>) => void;
}) {
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const latest = useRef(theme);
  latest.current = theme;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const baseSurfaces = theme.surfaces ?? {
    background: theme[mode].background,
    navigation: theme.plasma?.enabled ? theme.plasma.frost * 0.9 : 100,
    editor: theme.plasma?.enabled ? Math.min(95, theme.plasma.frost * 1.1) : 100,
    outline: theme.plasma?.enabled ? theme.plasma.frost * 0.9 : 100, titlebar: 100,
  };
  const surfaces = surfacesForMode(baseSurfaces, mode);
  const changeOpacity = (key: typeof surfaceKeys[number] | 'titlebarShadow', value: number) => change({ surfaces: mode === 'light' && baseSurfaces.light
    ? { ...baseSurfaces, light: { ...baseSurfaces.light, [key]: value } }
    : { ...baseSurfaces, [key]: value } });
  const names = { navigation: 'Navigation', editor: 'Editor', outline: 'Outline', titlebar: 'Title bar' };
  return <section className="theme-advanced-surfaces">
    <h3>Advanced surfaces</h3>
    <p className="settings-description">Lower panel opacity to reveal the background. Text and controls stay opaque. These settings apply in both standard and Plasma modes.</p>
    {theme.design?.css && <p className="settings-description">Custom CSS can override panel backgrounds and opacity. If a slider has no visible effect, check the matching panel rules in Advanced CSS.</p>}
    <ThemeColorField label="Window background" name="Window background" value={surfaces.background}
      onChange={background => change({ surfaces: { ...baseSurfaces, background } })}/>
    <label className="setting-row">Background image
      <select aria-label="Background image" value={surfaces.image ?? ''} onChange={e => change({ surfaces: { ...baseSurfaces, image: e.target.value || undefined } })}>
        <option value="">None</option>
        {Object.entries(theme.design?.assets ?? {}).filter(([, asset]) => asset.mime.startsWith('image/')).map(([path]) => <option key={path} value={path}>{path.slice(7)}</option>)}
      </select>
    </label>
    <label className="setting-row">Add background image
      <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Add background image" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        try {
          setError('');
          const ext = file.name.split('.').pop()?.toLowerCase();
          if (!ext || !['png','jpg','jpeg','webp'].includes(ext)) throw new Error('Choose a PNG, JPEG, or WebP image.');
          if (file.size > 2_100_000) throw new Error('Choose an image smaller than 2 MB.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!mounted.current) return;
          let binary = '';
          for (let i=0; i<bytes.length; i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
          const current = latest.current;
          const path = `assets/background-${crypto.randomUUID()}.${ext}`;
          const design = parseThemeDesign({ ...(current.design ?? defaultThemeDesign), assets: { ...current.design?.assets, [path]: { mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', data: btoa(binary) } } });
          change({ schemaVersion: 2, design, surfaces: { ...(current.surfaces ?? surfaces), image: path } });
        } catch (e) { if (mounted.current) setError(String(e)); }
      }}/>
    </label>
    {error && <p role="alert">{error}</p>}
    {surfaceKeys.map(key => <label className="setting-row" key={key}>
      <span>{names[key]} opacity <output>{Math.round(surfaces[key])}%</output></span>
      <input type="range" aria-label={`${names[key]} opacity`} min={0} max={100} value={surfaces[key]}
        onChange={e => changeOpacity(key, Number(e.target.value))}/>
    </label>)}
    <label className="setting-row">
      <span>Title bar shadow opacity <output>{surfaces.titlebarShadow ?? 100}%</output></span>
      <input type="range" aria-label="Title bar shadow opacity" min={0} max={100} value={surfaces.titlebarShadow ?? 100}
        onChange={e => changeOpacity('titlebarShadow', Number(e.target.value))}/>
    </label>
    <label className="theme-preview-toggle">
      <input type="checkbox" checked={theme.accentTitlebar}
        onChange={event => change({ accentTitlebar: event.target.checked })} />
      Colored title bar
    </label>
    <div className="theme-surface-plasma">
      <label className="theme-preview-toggle">
        <input
          type="checkbox"
          checked={theme.plasma?.enabled ?? false}
          onChange={(event) =>
            change({
              plasma: {
                ...(theme.plasma ?? defaultPlasmaSettings),
                enabled: event.target.checked,
              },
            })
          }
        />
        Enable Plasma UI
      </label>
      {theme.plasma?.enabled ? (
        <>
          <label className="theme-preview-toggle">
            <input type="checkbox" checked={theme.plasma.ambientDrops ?? false}
              onChange={event => change({ plasma: { ...theme.plasma!, ambientDrops: event.target.checked } })} />
            Ambient bubbles
          </label>
          <p className="settings-description">Adds floating Plasma bubbles. Lower panel opacity to see them through the glass. Hidden when Reduce Motion is enabled.</p>
          <label className="setting-row">
            Flow
            <input type="range" min={0} max={100} value={theme.plasma.flow ?? 0}
              onChange={event => change({ plasma: { ...theme.plasma!, flow: Number(event.target.value) } })} />
          </label>
          <p className="settings-description">Ripples the glass edges. Higher values make the waves more visible; zero keeps them still. Paused when Reduce Motion is enabled.</p>
          <label className="setting-row">
            Panel frostiness
            <input
              type="range"
              min={0}
              max={100}
              value={theme.plasma.frost}
              onChange={(e) =>
                change({
                  plasma: {
                    ...theme.plasma!,
                    frost: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label className="setting-row">
            Background blur
            <input
              type="range"
              min={0}
              max={40}
              value={theme.plasma.backgroundBlur}
              onChange={(e) =>
                change({
                  plasma: {
                    ...theme.plasma!,
                    backgroundBlur: Number(e.target.value),
                  },
                })
              }
            />
          </label>
        </>
      ) : null}
    </div>
  </section>;
}
