// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ThemeWorkbenchPreview } from './ThemeWorkbenchPreview';
import { exampleTheme } from '../lib/themes.fixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('./PlasmaTheme', () => ({ default: () => null }));

it('fits the desktop preview to both dimensions and updates without remounting on resize', async () => {
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  let width = 360, height = 240;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ThemeWorkbenchPreview theme={exampleTheme()} mode="dark" />));
    const host = container.querySelector<HTMLElement>('.theme-workbench-preview')!;
    const layout = host.shadowRoot!.querySelector('.preview-layout');
    expect(host.style.getPropertyValue('--preview-scale')).toBe('0.3');
    width = 1000; height = 400;
    await act(async () => resize());
    expect(host.style.getPropertyValue('--preview-scale')).toBe('0.5');
    expect(host.style.getPropertyValue('--preview-left')).toBe('200px');
    expect(host.shadowRoot!.querySelector('.preview-layout')).toBe(layout);
    width = 1800; height = 1000;
    await act(async () => resize());
    expect(host.style.getPropertyValue('--preview-scale')).toBe('1');
  } finally {
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
