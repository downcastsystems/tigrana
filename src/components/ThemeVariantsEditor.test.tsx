// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ThemeVariantsEditor } from './ThemeVariantsEditor';
import { classicThemes } from '../lib/bundledThemes';
import type { ThemeDocument } from '../lib/themes';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('creates two named palettes, renames, defaults, and deletes without altering shared design', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  let theme: ThemeDocument = classicThemes[0], selected: string | undefined;
  const render = () => root.render(<ThemeVariantsEditor theme={theme} selected={selected} onSelect={id => { selected = id; render(); }} onChange={value => { theme = value; render(); }} />);
  const click = async (name: string) => act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === name)!.click(); });
  async function input(value: string) {
    await act(async () => {
      const element = [...host.querySelectorAll('input')].at(-1)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  try {
    await act(async () => render());
    await click('Add color variant'); await input('Ocean'); await click('Create variant');
    expect(theme.colorVariants?.map(v => v.name)).toEqual(['Original', 'Ocean']);
    expect(selected).toBe(theme.colorVariants![1].id);
    expect(theme.design).toEqual(classicThemes[0].design);
    await click('Rename'); await input('Sea'); await click('Save name');
    expect(theme.colorVariants![1].name).toBe('Sea');
    await click('Make default'); expect(theme.defaultColorVariantId).toBe(selected);
    await click('Delete'); await click('Delete variant');
    expect(theme.colorVariants).toHaveLength(1);
    expect(theme.defaultColorVariantId).toBe(theme.colorVariants![0].id);
  } finally { await act(async () => root.unmount()); }
});
