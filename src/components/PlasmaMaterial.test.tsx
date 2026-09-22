// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PlasmaMaterial from './PlasmaMaterial';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@cruxgarden/plasma-ui', () => ({ PlasmaRenderer: { create } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, images: HTMLImageElement[];
let bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[];
let renderer: { settings: Record<string, unknown>; configure: (settings: Record<string, unknown>) => void; register: () => { remove: () => void }; destroy: () => void };
const props = { theme: 'dark' as const, accentColor: '#c5a5ed', frost: 0.88, backgroundBlur: 8, layoutKey: 'panes' };
const render = async (backgroundImage?: string) => act(async () => root.render(<PlasmaMaterial {...props} backgroundImage={backgroundImage} />));
const ready = () => host.querySelector('[data-plasma-image-ready]');
beforeEach(() => {
  host = document.createElement('div'); root = createRoot(host); images = []; bitmaps = [];
  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    const bitmap = { width: 100, height: 80, close: vi.fn() }; bitmaps.push(bitmap); return bitmap;
  }));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('Image', vi.fn(function () { const image = document.createElement('img'); images.push(image); return image; }));
  renderer = { settings: {}, configure: vi.fn(settings => { renderer.settings = settings; }), register: vi.fn(() => ({ remove: vi.fn() })), destroy: vi.fn() };
  create.mockImplementation((_canvas, settings) => { renderer.settings = settings; return renderer; });
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('keeps the CSS fallback until the landscape is loaded, then gives it to Plasma without recreating the renderer', async () => {
  await render('data:image/webp;base64,first');
  expect(ready()).toBeNull();
  expect(renderer.settings.background).toBeNull();
  await act(async () => images[0].dispatchEvent(new Event('load')));
  expect(createImageBitmap).toHaveBeenCalledWith(images[0], { imageOrientation: 'none' });
  expect(renderer.settings.background).toBe(bitmaps[0]);
  expect(renderer.settings.rimColor).toBe(props.accentColor);
  expect(ready()).not.toBeNull();
  await render();
  expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
  expect(renderer.settings.background).toBeNull();
  expect(ready()).toBeNull();
  expect(create).toHaveBeenCalledTimes(1);
});

it('does not let a stale image replace the newly selected landscape', async () => {
  await render('data:image/webp;base64,first');
  const staleLoad = images[0].onload!;
  await render('data:image/webp;base64,second');
  staleLoad.call(images[0], new Event('load'));
  expect(ready()).toBeNull();
  await act(async () => images[1].dispatchEvent(new Event('load')));
  expect(renderer.settings.background).toBe(bitmaps[0]);
  expect(ready()).not.toBeNull();
});

it('retains the CSS fallback when the landscape cannot load', async () => {
  await render('data:image/webp;base64,broken');
  images[0].dispatchEvent(new Event('error'));
  expect(ready()).toBeNull();
});

it('releases a late decoded bitmap without replacing the current background', async () => {
  let finish!: (bitmap: ImageBitmap) => void;
  vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render('data:image/webp;base64,first');
  images[0].dispatchEvent(new Event('load'));
  await render('data:image/webp;base64,second');
  await act(async () => images[1].dispatchEvent(new Event('load')));
  const current = renderer.settings.background;
  const stale = { width: 100, height: 80, close: vi.fn() } as unknown as ImageBitmap;
  await act(async () => finish(stale));
  expect(stale.close).toHaveBeenCalledTimes(1);
  expect(renderer.settings.background).toBe(current);
  expect(ready()).not.toBeNull();
});

it('keeps the CSS fallback if upright bitmap decoding fails or is unavailable', async () => {
  vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode failed'));
  await render('data:image/webp;base64,first');
  await act(async () => images[0].dispatchEvent(new Event('load')));
  expect(ready()).toBeNull();
  vi.stubGlobal('createImageBitmap', undefined);
  await render('data:image/webp;base64,second');
  await act(async () => images[1].dispatchEvent(new Event('load')));
  expect(ready()).toBeNull();
});

it('retains the CSS fallback when WebGL is unavailable', async () => {
  create.mockReturnValue(null);
  await render('data:image/webp;base64,first');
  expect(ready()).toBeNull();
  expect(host.querySelector('canvas')!.hidden).toBe(true);
  expect(images).toHaveLength(0);
});

it('gives Flow a visible range without animating panel layout or recreating the canvas', async () => {
  await act(async () => root.render(<PlasmaMaterial {...props} flow={1} />));
  expect(renderer.settings.flow).toBe(4);
  expect(renderer.settings.animateSurfaces).toBe(false);
  expect(renderer.settings.pointerLightAtCursor).toBe(true);
  await act(async () => root.render(<PlasmaMaterial {...props} flow={0} frost={0} backgroundBlur={0} />));
  expect(renderer.settings.flow).toBe(0);
  expect(renderer.settings.frost).toBe(0);
  expect(renderer.settings.opacity).toBe(0);
  expect(renderer.settings.wash).toBe(0);
  expect(renderer.settings.backgroundBlur).toBe(0);
  expect(create).toHaveBeenCalledTimes(1);
});

it('disables edge motion for reduced motion and restores it afterward', async () => {
  const motion = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => motion);
  await act(async () => root.render(<PlasmaMaterial {...props} flow={0.5} ambientDrops />));
  expect(renderer.settings.flow).toBe(0);
  expect(renderer.settings.ambientDrops).toBe(false);
  const listener = motion.addEventListener.mock.calls.at(-1)![1];
  motion.matches = false;
  listener();
  expect(renderer.settings.flow).toBe(2);
  expect(renderer.settings.ambientDrops).toBe(true);
  expect(renderer.settings.pointerDrop).toBe(false);
  expect(renderer.settings.ambientPointerPull).toBe(true);
  expect(renderer.settings.reducedMotion).toBe(false);
  motion.matches = true;
  listener();
  expect(renderer.settings.flow).toBe(0);
  expect(renderer.settings.ambientDrops).toBe(false);
});

it('composes native ambient glass behind panels and toggles it without recreating the renderer', async () => {
  await render();
  const canvas = host.querySelector('canvas');
  expect(renderer.settings.ambientDrops).toBe(false);
  await act(async () => root.render(<PlasmaMaterial {...props} ambientDrops />));
  expect(renderer.settings.ambientDrops).toBe(true);
  expect(renderer.settings.pointerDrop).toBe(false);
  expect(renderer.settings.ambientPointerPull).toBe(true);
  expect(renderer.settings.ambientBehindSurfaces).toBe(true);
  expect(renderer.settings.ambientBounds).toBe(host);
  expect(host.querySelector('svg')).toBeNull();
  expect(host.querySelectorAll('canvas')).toHaveLength(1);
  await render();
  expect(renderer.settings.ambientDrops).toBe(false);
  expect(renderer.settings.pointerDrop).toBe(false);
  expect(renderer.settings.ambientPointerPull).toBe(false);
  expect(host.querySelector('canvas')).toBe(canvas);
  expect(create).toHaveBeenCalledTimes(1);
});

it('rescales glass corners with the preview without recreating the renderer', async () => {
  const renderPreview = (surfaceScale: number) => act(async () => root.render(
    <div><PlasmaMaterial {...props} surfaceScale={surfaceScale} /><main className="main-pane" /></div>,
  ));
  await renderPreview(0.5);
  expect(renderer.register).toHaveBeenLastCalledWith(host.querySelector('.main-pane'), expect.objectContaining({ radius: 9 }));
  await renderPreview(1);
  expect(renderer.register).toHaveBeenLastCalledWith(host.querySelector('.main-pane'), expect.objectContaining({ radius: 18 }));
  expect(create).toHaveBeenCalledTimes(1);
});
