import { ThemeWorkbenchPreview } from "./ThemeWorkbenchPreview";
// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ThemeSurfacesEditor } from './ThemeSurfacesEditor';
import { bundledThemes, classicThemes } from '../lib/bundledThemes';
import { parseThemeSurfaces } from '../lib/themeSurfaces';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('edits the light shadow without altering dark defaults', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), change = vi.fn();
  const theme = classicThemes.find(t => t.id === 'dracula')!;
  try {
    await act(async () => root.render(<ThemeSurfacesEditor theme={theme} mode="light" change={change} />));
    const shadow = host.querySelector<HTMLInputElement>('[aria-label="Title bar shadow opacity"]')!;
    expect(shadow.value).toBe('0');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Editor opacity"]')!.value).toBe('45');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(shadow, '25');
      shadow.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(change.mock.lastCall![0].surfaces.light.titlebarShadow).toBe(25);
    expect(change.mock.lastCall![0].surfaces.editor).toBe(35);
    expect(change.mock.lastCall![0].surfaces.titlebarShadow).toBeUndefined();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('rejects invalid shadow and light opacity values', () => {
  const surfaces = classicThemes.find(t => t.id === 'dracula')!.surfaces!;
  for (const value of [-1, 101, '20', null, NaN]) {
    expect(() => parseThemeSurfaces({ ...surfaces, titlebarShadow: value })).toThrow();
    expect(() => parseThemeSurfaces({ ...surfaces, light: { editor: value } })).toThrow();
  }
});


it('updates the Starfall preview when titlebar controls change', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [theme, setTheme] = useState(bundledThemes.find(t => t.id === 'builtin-starfall-studio')!);
    return <><ThemeSurfacesEditor theme={theme} mode="light" change={patch => setTheme(current => ({ ...current, ...patch }))} />
      <ThemeWorkbenchPreview theme={theme} mode="light" showControls={false} /></>;
  }
  const css = () => host.querySelector('.theme-workbench-preview')!.shadowRoot!.textContent!;
  const changeRange = async (label: string, value: string) => act(async () => {
    const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  try {
    await act(async () => root.render(<Harness />));
    expect(css()).toContain('--tigrana-titlebar-fill: color-mix(in srgb,var(--surface) 0%,transparent)');
    await changeRange('Title bar opacity', '80');
    expect(css()).toContain('--tigrana-titlebar-fill: color-mix(in srgb,var(--surface) 80%,transparent)');
    expect(css()).toContain('linear-gradient(var(--tigrana-titlebar-fill,transparent),var(--tigrana-titlebar-fill,transparent))');
    await changeRange('Title bar shadow opacity', '65');
    expect(css()).toContain('--tigrana-titlebar-shadow-opacity: 0.65');
    expect(css()).toContain('opacity:var(--tigrana-titlebar-shadow-opacity,0)');
    const colored = [...host.querySelectorAll('label')].find(label => label.textContent?.trim() === 'Colored title bar')!.querySelector('input')!;
    await act(async () => colored.click());
    expect(css()).toContain('--tigrana-titlebar-fill: color-mix(in srgb,var(--titlebar-bg) 80%,transparent)');
    const plasma = [...host.querySelectorAll('label')].find(label => label.textContent?.trim() === 'Enable Plasma UI')!.querySelector('input')!;
    expect(plasma.disabled).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
