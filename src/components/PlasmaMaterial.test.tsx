// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PlasmaMaterial from './PlasmaMaterial';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@cruxgarden/plasma-ui', () => ({ PlasmaRenderer: { create } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, images: HTMLImageElement[];
let renderer: { settings: Record<string, unknown>; configure: (settings: Record<string, unknown>) => void; register: () => { remove: () => void }; destroy: () => void };
const props = { theme: 'dark' as const, accentColor: '#c5a5ed', frost: 0.88, backgroundBlur: 8, layoutKey: 'panes' };
const render = async (backgroundImage?: string) => act(async () => root.render(<PlasmaMaterial {...props} backgroundImage={backgroundImage} />));
const ready = () => host.querySelector('[data-plasma-image-ready]');
beforeEach(() => {
  host = document.createElement('div'); root = createRoot(host); images = [];
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
  images[0].dispatchEvent(new Event('load'));
  expect(renderer.settings.background).toBe(images[0]);
  expect(renderer.settings.rimColor).toBe(props.accentColor);
  expect(ready()).not.toBeNull();
  await render();
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
  images[1].dispatchEvent(new Event('load'));
  expect(renderer.settings.background).toBe(images[1]);
  expect(ready()).not.toBeNull();
});

it('retains the CSS fallback when the landscape cannot load', async () => {
  await render('data:image/webp;base64,broken');
  images[0].dispatchEvent(new Event('error'));
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
  await act(async () => root.render(<PlasmaMaterial {...props} flow={0} frost={0} backgroundBlur={0} />));
  expect(renderer.settings.flow).toBe(0);
  expect(renderer.settings.frost).toBe(0);
  expect(renderer.settings.opacity).toBe(0);
  expect(renderer.settings.backgroundBlur).toBe(0);
  expect(create).toHaveBeenCalledTimes(1);
});

it('disables edge motion for reduced motion and restores the current Flow setting afterward', async () => {
  const motion = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => motion);
  await act(async () => root.render(<PlasmaMaterial {...props} flow={0.5} />));
  expect(renderer.settings.flow).toBe(0);
  const listener = motion.addEventListener.mock.calls.at(-1)![1];
  motion.matches = false;
  listener();
  expect(renderer.settings.flow).toBe(2);
  expect(renderer.settings.reducedMotion).toBe(false);
  motion.matches = true;
  listener();
  expect(renderer.settings.flow).toBe(0);
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
