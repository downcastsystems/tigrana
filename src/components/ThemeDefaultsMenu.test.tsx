// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ThemeDefaultsMenu } from "./ThemeDefaultsMenu";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const select = vi.fn();
beforeEach(async () => {
  select.mockClear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<ThemeDefaultsMenu disabled={false} onSelect={select} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it.each(['all', 'appearance', 'layout'] as const)('selects the %s scope and closes', async (scope) => {
  await act(async () => host.querySelector('button')!.click());
  const index = ['all', 'appearance', 'layout'].indexOf(scope);
  await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[index].click());
  expect(select).toHaveBeenCalledWith(scope);
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('button'));
});
it('supports arrow navigation and Escape without dismissing Settings', async () => {
  await act(async () => host.querySelector('button')!.click());
  const items = host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  expect(document.activeElement).toBe(items[0]);
  await act(async () => items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
  expect(document.activeElement).toBe(items[2]);
  const parent = vi.fn(); document.addEventListener('keydown', parent);
  try {
    await act(async () => items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(parent).not.toHaveBeenCalled();
    expect(host.querySelector('[role="menu"]')).toBeNull();
  } finally { document.removeEventListener('keydown', parent); }
});
it('dismisses on outside pointer down', async () => {
  await act(async () => host.querySelector('button')!.click());
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  expect(host.querySelector('[role="menu"]')).toBeNull();
});
it.each(['all', 'appearance', 'layout'] as const)('applies %s when the webview does not focus clicked buttons', async scope => {
  await act(async () => host.querySelector('button')!.click());
  const item = host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[['all', 'appearance', 'layout'].indexOf(scope)];
  // WebKit can blur the focused menu item to the document on mouse down,
  // instead of moving focus to the clicked button. Click arrives afterwards.
  await act(async () => {
    const allowDefault = item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    if (allowDefault) (document.activeElement as HTMLElement).blur();
  });
  await act(async () => item.click());
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith(scope);
  expect(host.querySelector('[role="menu"]')).toBeNull();
});
it('dismisses when keyboard focus leaves the control', async () => {
  await act(async () => host.querySelector('button')!.click());
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  try {
    await act(async () => outside.focus());
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(select).not.toHaveBeenCalled();
  } finally { outside.remove(); }
});
