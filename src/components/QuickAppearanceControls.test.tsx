// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuickAppearanceControls } from './QuickAppearanceControls';
import type { NotebookWallpaper } from '../types';
import { exampleTheme } from '../lib/themes.fixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});
afterEach(() => { vi.restoreAllMocks(); });

async function mount(customized = true, wallpapers?: NotebookWallpaper[]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const theme = exampleTheme();
  const onChange = vi.fn();
  const onReset = vi.fn();
  await act(async () => root.render(<QuickAppearanceControls theme={theme} mode="dark"
    current={{ accentColor: theme.dark.accent, editorFontFamily: theme.editorFontFamily, editorFontSize: theme.editorFontSize }}
    quick={customized ? { panelOpacity: 45, backgroundImage: { name: 'original.png', asset: { mime: 'image/png', data: png } } } : undefined}
    onDeleteWallpaper={vi.fn(async () => {})} wallpapers={wallpapers} onChange={onChange} onReset={onReset} />));
  const choose = async (file: File) => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  };
  const close = async () => { await act(async () => root.unmount()); host.remove(); };
  return { host, onChange, onReset, choose, close };
}

it('uploads a validated portable image and resets controls independently', async () => {
  const test = await mount();
  try {
    const input = test.host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openPicker = vi.spyOn(input, 'click');
    const changeButton = test.host.querySelector<HTMLButtonElement>('.quick-background-control .toolbar-button')!;
    await act(async () => changeButton.click());
    expect(openPicker).not.toHaveBeenCalled();
    await act(async () => test.host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    expect(openPicker).toHaveBeenCalledOnce();
    expect(input.hidden).toBe(true);
    expect(test.host.querySelector('img[alt="Current background"]')?.getAttribute('src')).toBe(`data:image/png;base64,${png}`);
    expect(test.host.textContent).not.toContain('original.png');
    const file = new File([], 'landscape.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes });
    await test.choose(file);
    expect(test.onChange).toHaveBeenCalledWith({ backgroundImage: { name: 'landscape.png', asset: { mime: 'image/png', data: png } } });
    expect(test.host.querySelector('input[aria-label="Quick panel opacity"]')?.getAttribute('value')).toBe('45');
    for (const label of ['panel opacity', 'background image']) {
      await act(async () => test.host.querySelector<HTMLButtonElement>(`button[aria-label="Reset ${label} to theme default"]`)!.click());
    }
    expect(document.activeElement).toBe(changeButton);
    expect(test.onReset.mock.calls).toEqual([['panelOpacity'], ['backgroundImage']]);
    expect(test.host.textContent).toContain('Supported themes only.');
  } finally { await test.close(); }
});

it('rejects disguised image contents without publishing an override', async () => {
  const test = await mount();
  try {
    const file = new File([], 'fake.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer });
    await test.choose(file);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(test.host.querySelector('[role="alert"]')?.textContent).toContain('Asset contents do not match');
  } finally { await test.close(); }
});

it('discards an image read that finishes after the controls unmount', async () => {
  const test = await mount();
  let finish!: (value: ArrayBuffer) => void;
  const file = new File([], 'late.png', { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
  try {
    await test.choose(file);
  } finally { await test.close(); }
  await act(async () => finish(bytes));
  expect(test.onChange).not.toHaveBeenCalled();
});

it('keeps accent and font size outside additional options, opening those only for custom settings', async () => {
  for (const customized of [false, true]) {
    const test = await mount(customized);
    try {
      const details = test.host.querySelector('details')!;
      expect(details.open).toBe(customized);
      expect(details.contains(test.host.querySelector('[aria-label="Quick editor font size"]'))).toBe(false);
      expect(details.contains(test.host.querySelector('[aria-label="Quick accent color"]'))).toBe(false);
      expect(details.contains(test.host.querySelector('[aria-label="Quick editor font"]'))).toBe(true);
      expect(details.contains(test.host.querySelector('[aria-label="Quick panel opacity"]'))).toBe(true);
    } finally { await test.close(); }
  }
});

it('chooses a saved notebook wallpaper without reopening the computer picker', async () => {
  const test = await mount();
  try {
    const openPicker = vi.spyOn(test.host.querySelector<HTMLInputElement>('input[type="file"]')!, 'click');
    await act(async () => test.host.querySelector<HTMLButtonElement>('.quick-background-control .toolbar-button')!.click());
    const saved = test.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1];
    expect(saved.textContent).toBe('From this notebook…');
    await act(async () => saved.click());
    expect(test.host.querySelector('dialog[open]')).not.toBeNull();
    await act(async () => test.host.querySelector<HTMLButtonElement>('.notebook-wallpaper-choice')!.click());
    expect(test.host.querySelector('dialog')).toBeNull();
    expect(test.onChange).toHaveBeenCalledWith({ backgroundImage: { name: 'original.png', asset: { mime: 'image/png', data: png } } });
    expect(openPicker).not.toHaveBeenCalled();
    expect(test.host.querySelector('[role="menu"]')).toBeNull();
  } finally { await test.close(); }
});

it('supports arrow navigation and Escape without choosing a wallpaper', async () => {
  const test = await mount();
  try {
    const trigger = test.host.querySelector<HTMLButtonElement>('.quick-background-control .toolbar-button')!;
    await act(async () => trigger.click());
    const menu = test.host.querySelector('[role="menu"]')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement?.textContent).toBe('From this notebook…');
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(trigger);
    expect(test.host.querySelector('[role="menu"]')).toBeNull();
    expect(test.onChange).not.toHaveBeenCalled();
  } finally { await test.close(); }
});

it('offers saved wallpapers even after the active background has been reset', async () => {
  const wallpaper = { name: 'saved.png', asset: { mime: 'image/png', data: png } };
  const test = await mount(false, [wallpaper]);
  try {
    await act(async () => test.host.querySelector<HTMLButtonElement>('.quick-background-control .toolbar-button')!.click());
    const saved = test.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1];
    await act(async () => saved.click());
    const thumbnail = test.host.querySelector<HTMLButtonElement>('.notebook-wallpaper-choice')!;
    expect(thumbnail.textContent).toBe('saved.png');
    await act(async () => thumbnail.click());
    expect(test.onChange).toHaveBeenCalledWith({ backgroundImage: wallpaper });
  } finally { await test.close(); }
});

it('shows an empty notebook gallery and dismisses it with Escape without changing the background', async () => {
  const test = await mount(false);
  try {
    const trigger = test.host.querySelector<HTMLButtonElement>('.quick-background-control .toolbar-button')!;
    await act(async () => trigger.click());
    expect([...test.host.querySelectorAll('[role="menuitem"]')].map(item => item.textContent))
      .toEqual(['From my computer…', 'From this notebook…']);
    await act(async () => test.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1].click());
    const dialog = test.host.querySelector('dialog')!;
    expect(dialog.textContent).toContain('No wallpapers saved yet.');
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(test.host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(test.onChange).not.toHaveBeenCalled();
  } finally { await test.close(); }
});
