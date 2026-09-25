// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { NotebookWallpaperDialog } from './NotebookWallpaperDialog';
import { exampleTheme } from '../lib/themes.fixture';
import { defaultThemeDesign } from '../lib/themeDesign';
import { listThemes } from '../lib/themes';
vi.mock('../lib/themes', async importOriginal => ({ ...await importOriginal<typeof import('../lib/themes')>(), listThemes: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const wallpaper = { name: 'saved.png', asset: { mime: 'image/png', data: 'image-data' } };
const custom = { ...exampleTheme(), design: { ...defaultThemeDesign, assets: { 'assets/other-name.png': wallpaper.asset } } };
beforeEach(() => {
  vi.mocked(listThemes).mockReset().mockResolvedValue({ themes: [], warnings: [] });
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});
async function mount(active = false) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), remove = vi.fn(async () => {}), select = vi.fn();
  await act(async () => root.render(<NotebookWallpaperDialog wallpapers={[wallpaper]} theme={exampleTheme()}
    active={active ? wallpaper : undefined} onDelete={remove} onSelect={select} onClose={vi.fn()} />));
  return { host, remove, select, button: host.querySelector<HTMLButtonElement>('[aria-label="Delete saved.png"]')!,
    close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
it('deletes an unused wallpaper without selecting it or closing the picker', async () => {
  const test = await mount();
  try {
    expect(test.button.disabled).toBe(false);
    await act(async () => test.button.click());
    expect(test.remove).toHaveBeenCalledWith(wallpaper);
    expect(test.select).not.toHaveBeenCalled();
    expect(test.host.querySelector('dialog')).not.toBeNull();
  } finally { await test.close(); }
});
it('disables deletion with an explanation when a saved custom theme uses the image', async () => {
  vi.mocked(listThemes).mockResolvedValue({ themes: [custom], warnings: [] });
  const test = await mount();
  try {
    expect(test.button.disabled).toBe(true);
    expect(test.button.parentElement?.title).toBe('In use in a custom theme.');
    await act(async () => test.button.click());
    expect(test.remove).not.toHaveBeenCalled();
  } finally { await test.close(); }
});
it('protects the active notebook background', async () => {
  const test = await mount(true);
  try { expect(test.button.disabled).toBe(true); expect(test.button.title).toContain('Currently used'); }
  finally { await test.close(); }
});
it('rechecks themes before deleting', async () => {
  const test = await mount();
  try {
    vi.mocked(listThemes).mockResolvedValue({ themes: [custom], warnings: [] });
    await act(async () => test.button.click());
    expect(test.remove).not.toHaveBeenCalled();
    expect(test.button.disabled).toBe(true);
  } finally { await test.close(); }
});
it('keeps deletion disabled if the custom-theme library cannot be read', async () => {
  vi.mocked(listThemes).mockRejectedValue(new Error('Unavailable'));
  const test = await mount();
  try { expect(test.button.disabled).toBe(true); expect(test.host.querySelector('[role="alert"]')).not.toBeNull(); }
  finally { await test.close(); }
});
