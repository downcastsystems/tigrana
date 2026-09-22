// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlasmaRenderer, type RendererSettings } from '@cruxgarden/plasma-ui';

// Exercise the patched renderer itself. The GL stub records pass boundaries;
// browser verification covers the actual shader compilation and visual result.
type Program = { shaders: { source: string }[]; values: Record<string, number> };
let canvas: HTMLCanvasElement, scope: HTMLDivElement, renderer: PlasmaRenderer;
let frames: Map<number, FrameRequestCallback>;
let composites: { target: object | null; ambient: number; count: number }[];
let lightingSamples: { x: number; y: number; paneLight: number }[];
let pointerSamples: { x: number; y: number; amount: number }[];
let glassSettings: { ambient: number; pull: number; cursorRadius: number; wash: number }[];
let allocated: ReturnType<typeof vi.fn>, deletedTextures: ReturnType<typeof vi.fn>;
let settings: RendererSettings;
function frame() {
  const pending = [...frames.values()]; frames.clear();
  pending.forEach(callback => callback(performance.now()));
}
beforeEach(() => {
  scope = document.createElement('div'); canvas = document.createElement('canvas');
  scope.append(canvas); document.body.append(scope);
  vi.spyOn(scope, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 30, width: 800, height: 600 } as DOMRect);
  frames = new Map(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.set(++id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(id => frames.delete(id)));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  lightingSamples = [];
  pointerSamples = [];
  glassSettings = [];
  composites = []; let program: Program, target: object | null = null;
  allocated = vi.fn(); deletedTextures = vi.fn();
  const methods: Record<string, unknown> = {
    getExtension: () => null, isContextLost: () => false,
    getShaderParameter: () => true, getProgramParameter: () => true,
    createShader: () => ({ source: '' }), createProgram: () => ({ shaders: [], values: {} }),
    shaderSource: (shader: { source: string }, source: string) => { shader.source = source; },
    attachShader: (p: Program, shader: { source: string }) => p.shaders.push(shader),
    useProgram: (p: Program) => { program = p; },
    getUniformLocation: (p: Program, name: string) => ({ p, name }),
    uniform1f: (location: { p: Program; name: string }, value: number) => { location.p.values[location.name] = value; },
    uniform2f: (location: { p: Program; name: string }, x: number, y: number) => { location.p.values[location.name + 'X'] = x; location.p.values[location.name + 'Y'] = y; },
    uniform1i: (location: { p: Program; name: string }, value: number) => { location.p.values[location.name] = value; },
    bindFramebuffer: (_kind: unknown, fb: object | null) => { target = fb; },
    texImage2D: allocated, deleteTexture: deletedTextures,
    drawArrays: () => {
      if (program.shaders.some(shader => shader.source.includes('uniform sampler2D uH,'))) {
        if (program.values.uAmbient) pointerSamples.push({ x: program.values.uMouseX, y: program.values.uMouseY, amount: program.values.uMouseAmt });
        lightingSamples.push({ x: program.values.uLightMouseX, y: program.values.uLightMouseY, paneLight: program.values.uCursorLight });
        composites.push({ target, ambient: program.values.uAmbient, count: program.values.uCount });
        glassSettings.push({ ambient: program.values.uAmbient, pull: program.values.uAmbientPull, cursorRadius: program.values.uDropR, wash: program.values.uWash });
      }
    },
  };
  const gl = new Proxy(methods, { get(object, name: string) {
    if (!(name in object)) object[name] = /^[A-Z_0-9]+$/.test(name) ? name : name.startsWith('create') ? () => ({}) : vi.fn();
    return object[name];
  } });
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl as unknown as WebGL2RenderingContext);
  settings = {
    colors: ['#140e0e', '#800c0c', '#a34b4b'], blend: 0, theme: 'dark', tint: '#192a32', opacity: 0.2,
    frost: 0.25, quality: 1, freezeOnScroll: false, shimmer: 0.5, glow: 0.55, wash: 1, grain: 1,
    backgroundBlur: 0, maxSurfaces: 4, pointerDrop: false, pointerLightAtCursor: true, ambientPointerPull: true, ambientDrops: true, ambientBehindSurfaces: true,
    ambientBounds: scope, animateSurfaces: false, reducedMotion: false, stretch: 0, flow: 0.8,
    viscosity: 0.85, refraction: 0.7, dispersion: 0.4, rim: 0.45, rimColor: '#800c0c', rimWidth: 1,
    highlight: 0.6, edgeLine: 0.65, smoothness: 1, elevation: 0.2, background: null,
  };
  renderer = PlasmaRenderer.create(canvas, settings)!;
  expect(renderer).not.toBeNull();
});
afterEach(() => { renderer?.destroy(); scope.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('draws clear native drops in a separate background pass before panel glass, using one frame loop', () => {
  const pane = document.createElement('div'); scope.append(pane);
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 510, bottom: 610, width: 500, height: 600 } as DOMRect);
  Object.defineProperties(pane, { offsetWidth: { value: 500 }, offsetHeight: { value: 600 } });
  renderer.register(pane, { radius: 18, lean: 0, fuse: false });
  frame();
  expect(composites).toEqual([
    { target: expect.any(Object), ambient: 1, count: 0 },
    { target: null, ambient: 0, count: 1 },
  ]);
  const allocationCount = allocated.mock.calls.length;
  composites.length = 0; frame();
  expect(allocated).toHaveBeenCalledTimes(allocationCount);
  expect(frames.size).toBe(1);
});

it('skips the extra pass when disabled or reduced motion is active, and reuses it after toggling', () => {
  frame(); const allocationCount = allocated.mock.calls.length;
  for (const changes of [{ ambientDrops: false }, { reducedMotion: true }]) {
    composites.length = 0;
    renderer.configure({ ...settings, ...changes }); frame();
    expect(composites).toEqual([{ target: null, ambient: 0, count: 0 }]);
  }
  renderer.configure(settings); composites.length = 0; frame();
  expect(composites).toHaveLength(2);
  expect(allocated).toHaveBeenCalledTimes(allocationCount);
});

it('rebuilds and sizes targets after context restoration and releases resources', () => {
  frame(); const count = allocated.mock.calls.length;
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  expect(frames.size).toBe(0);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  frame();
  expect(allocated.mock.calls.length).toBeGreaterThan(count);
  renderer.destroy();
  expect(frames.size).toBe(0);
  expect(deletedTextures).toHaveBeenCalled();
});

it('resizes the ambient and background targets together without creating another frame loop', () => {
  frame();
  const target = composites[0].target;
  const previousWidth = canvas.width;
  vi.useFakeTimers(); allocated.mockClear();
  renderer.configure({ ...settings, quality: 0.5 });
  vi.advanceTimersByTime(121);
  expect(canvas.width).toBeLessThan(previousWidth);
  const fullSizeAllocations = allocated.mock.calls.filter(call => call[3] === canvas.width && call[4] === canvas.height);
  expect(fullSizeAllocations).toHaveLength(2);
  composites.length = 0; frame();
  expect(composites[0].target).toBe(target);
  expect(frames.size).toBe(1);
});


it('pulls on background bubbles without a cursor drop or milky wash and disables interaction for reduced motion', () => {
  frame();
  expect(glassSettings).toEqual([
    { ambient: 1, pull: 1, cursorRadius: 0, wash: 0 },
    { ambient: 0, pull: 0, cursorRadius: 0, wash: 1 },
  ]);
  for (const change of [{ reducedMotion: true }, { ambientDrops: false }]) {
    glassSettings.length = 0;
    renderer.configure({ ...settings, ...change }); frame();
    expect(glassSettings).toEqual([{ ambient: 0, pull: 0, cursorRadius: 0, wash: 1 }]);
  }
});


it('delivers real pointer movement to the bubble shader and fades interaction on pointer leave', () => {
  const now = vi.spyOn(performance, 'now');
  now.mockReturnValue(1000); frame();
  const initial = pointerSamples.at(-1)!;
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 920, clientY: 360 }));
  for (let i = 1; i <= 60; i++) { now.mockReturnValue(1000 + i * 16); frame(); }
  const near = pointerSamples.at(-1)!;
  expect(Math.abs(near.x - 920)).toBeLessThan(1);
  expect(Math.abs(near.y - 360)).toBeLessThan(1);
  expect(near.amount).toBeGreaterThan(0.95);
  expect(initial.amount).toBe(0);
  document.dispatchEvent(new Event('pointerleave'));
  for (let i = 61; i <= 120; i++) { now.mockReturnValue(1000 + i * 16); frame(); }
  expect(pointerSamples.at(-1)!.amount).toBeLessThan(0.05);
  expect(frames.size).toBe(1);
});


it('anchors pane lighting to raw pointer coordinates while bubbles retain their smoothing', () => {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 760, clientY: 500 }));
  frame();
  expect(lightingSamples).toEqual([
    { x: 760, y: 500, paneLight: 0 },
    { x: 760, y: 500, paneLight: 1 },
  ]);
  expect(pointerSamples.at(-1)!.x).not.toBe(760);
  expect(pointerSamples.at(-1)!.y).not.toBe(500);
  lightingSamples.length = 0;
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 320, clientY: 240 }));
  frame();
  expect(lightingSamples.at(-1)).toEqual({ x: 320, y: 240, paneLight: 1 });
});
