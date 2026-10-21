// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { TextShortcutSettings } from './TextShortcutSettings';
import { defaultBulletMethodStatuses, type BulletMethodStatus } from '../lib/bulletMethod';
import type { TextShortcut } from '../lib/textShortcuts';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
const shortcut = { id: 'a', name: 'Avery', trigger: 'n:a', markdown: 'AVERY' };
async function mount(save = vi.fn<[readonly TextShortcut[]], void>(), initialShortcuts: readonly TextShortcut[] = [shortcut]) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Harness({ statuses }: { statuses: readonly BulletMethodStatus[] }) {
    const [shortcuts, setShortcuts] = useState<readonly TextShortcut[]>(initialShortcuts);
    return <TextShortcutSettings shortcuts={shortcuts} statuses={statuses} onChange={next => { save(next); setShortcuts(next); }} />;
  }
  const render = async (statuses = defaultBulletMethodStatuses) => act(async () => root.render(<Harness statuses={statuses} />));
  await render();
  const button = (name: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent) === name)!;
  const click = async (name: string, scope: ParentNode = host) => act(async () => button(name, scope).click());
  const change = async (selector: string, value: string) => act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { host, save, render, button, click, change, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it('explains the colon and length rules and blocks unsafe triggers in the dialog', async () => {
  const test = await mount();
  try {
    await test.click('Edit Avery');
    expect(test.host.querySelector('dialog')?.textContent).toContain('3–64 characters with a colon anywhere');
    for (const trigger of ['a', 'a:', 'abc', ';abc', '/a:b', 'a b:']) {
      await test.change('dialog label:nth-of-type(2) input', trigger);
      expect(test.button('Save changes').disabled).toBe(true);
    }
    expect(test.save).not.toHaveBeenCalled();
    for (const trigger of [':ab', 'ab:']) {
      await test.change('dialog label:nth-of-type(2) input', trigger);
      expect(test.button('Save changes').disabled).toBe(false);
    }
    await test.click('Save changes');
    expect(test.save.mock.lastCall?.[0][0].trigger).toBe('ab:');
  } finally { await test.close(); }
});

it('flags legacy triggers for correction without removing the shortcut', async () => {
  const test = await mount(undefined, [{ ...shortcut, trigger: 'a' }]);
  try {
    const row = test.host.querySelector('tbody tr')!;
    expect(row.textContent).toContain('Avery');
    expect(row.textContent).toContain('AVERY');
    expect(row.querySelector('[role="alert"]')?.textContent).toContain('Typed expansion disabled.');
    expect(row.textContent).toContain('using /shortcut');
    await test.click('Edit Avery');
    expect(test.button('Save changes').disabled).toBe(true);
    await test.change('dialog label:nth-of-type(2) input', 'n:a');
    await test.click('Save changes');
    expect(test.host.querySelector('tbody [role="alert"]')).toBeNull();
  } finally { await test.close(); }
});

it('saves dialog edits immediately and has no main Save button', async () => {
  const test = await mount();
  try {
    expect(test.host.querySelector('table')?.textContent).toContain('Avery');
    expect(test.host.querySelector('textarea')).toBeNull();
    expect(test.button('Save shortcuts')).toBeUndefined();
    await test.click('Edit Avery');
    expect(test.host.querySelector('dialog[open] h2')?.textContent).toBe('Edit shortcut');
    expect(document.activeElement).toBe(test.host.querySelector('dialog input'));
    expect(test.button('Save changes').disabled).toBe(true);
    await test.change('textarea', '**AVERY**\n\n==Hello==');
    await test.click('Cancel');
    expect(test.save).not.toHaveBeenCalled();
    await test.click('Avery');
    expect(test.host.querySelector('textarea')?.value).toBe('AVERY');
    await test.change('textarea', '**AVERY**\n\n==Hello==');
    await test.click('Save changes');
    expect(test.host.querySelector('dialog')).toBeNull();
    expect(test.save).toHaveBeenCalledOnce();
    expect(test.save).toHaveBeenLastCalledWith([{ ...shortcut, markdown: '**AVERY**\n\n==Hello==' }]);
    expect(test.host.querySelector('table')?.textContent).toContain('==Hello==');
    expect(test.button('Save shortcuts')).toBeUndefined();
    expect(test.host.textContent).not.toContain('Unsaved changes');
  } finally { await test.close(); }
});

it('saves additions through a dialog and validates current status conflicts before saving', async () => {
  const test = await mount();
  try {
    await test.click('Add shortcut');
    await test.change('dialog input', 'Bo');
    await test.change('dialog label:nth-of-type(2) input', 'n:b');
    await test.change('textarea', '- TODO: Merge\n- TODO: Deploy');
    const conflict = defaultBulletMethodStatuses.map(status => status.id === 'todo' ? { ...status, shortcut: 'n:b' } : status);
    await test.render(conflict);
    const dialog = test.host.querySelector('dialog')!;
    expect(test.button('Add shortcut', dialog).disabled).toBe(true);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('conflicts with a Bullet Status');
    expect(test.save).not.toHaveBeenCalled();
    await test.render();
    await test.click('Add shortcut', dialog);
    expect(test.host.querySelector('table')?.textContent).toContain('Bo');
    expect(test.host.querySelector('dialog')).toBeNull();
    expect(test.save).toHaveBeenCalledOnce();
    expect(test.save.mock.lastCall?.[0][1]).toMatchObject({ name: 'Bo', trigger: 'n:b', markdown: '- TODO: Merge\n- TODO: Deploy' });
  } finally { await test.close(); }
});

it('requires confirmation for trash actions and saves deletion immediately', async () => {
  const test = await mount();
  try {
    await test.click('Delete Avery');
    expect(test.host.querySelector('dialog h2')?.textContent).toBe('Delete “Avery”?');
    expect(document.activeElement).toBe(test.button('Cancel'));
    expect(test.host.querySelector('table')?.textContent).toContain('Avery');
    await test.click('Cancel');
    expect(test.save).not.toHaveBeenCalled();
    await test.click('Delete Avery');
    await test.click('Delete shortcut');
    expect(test.host.querySelector('table')?.textContent).not.toContain('Avery');
    expect(test.save).toHaveBeenCalledOnce();
    expect(test.save).toHaveBeenLastCalledWith([]);
    expect(test.host.querySelector('dialog')).toBeNull();
  } finally { await test.close(); }
});

it('cancels Add with Escape without saving, and keeps failed edits in their dialog for retry', async () => {
  const save = vi.fn<[readonly TextShortcut[]], void>().mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
  const test = await mount(save);
  const outerEscape = vi.fn(); window.addEventListener('keydown', outerEscape);
  try {
    await test.click('Add shortcut');
    await test.change('dialog input', 'Draft');
    await act(async () => test.host.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(test.host.querySelector('dialog')).toBeNull();
    expect(outerEscape).not.toHaveBeenCalled();
    expect(test.save).not.toHaveBeenCalled();
    await test.click('Edit Avery');
    await test.change('textarea', 'Changed');
    await test.click('Save changes');
    expect(test.host.querySelector('dialog [role="alert"]')?.textContent).toBe('Storage unavailable');
    expect(test.host.querySelector('textarea')?.value).toBe('Changed');
    expect(test.host.querySelector('table')?.textContent).toContain('AVERY');
    expect(test.host.querySelector('table')?.textContent).not.toContain('Changed');
    await test.click('Save changes');
    expect(test.host.querySelector('dialog')).toBeNull();
    expect(test.host.querySelector('table')?.textContent).toContain('Changed');
    expect(test.save).toHaveBeenCalledTimes(2);
  } finally { window.removeEventListener('keydown', outerEscape); await test.close(); }
});

it('keeps the shortcut and confirmation open if automatic deletion fails, and allows retry', async () => {
  const save = vi.fn<[readonly TextShortcut[]], void>().mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
  const test = await mount(save);
  try {
    await test.click('Delete Avery');
    await test.click('Delete shortcut');
    expect(test.host.querySelector('dialog [role="alert"]')?.textContent).toBe('Storage unavailable');
    expect(test.host.querySelector('table')?.textContent).toContain('Avery');
    await test.click('Delete shortcut');
    expect(test.host.querySelector('dialog')).toBeNull();
    expect(test.host.querySelector('table')?.textContent).not.toContain('Avery');
    expect(test.save).toHaveBeenCalledTimes(2);
    expect(test.save).toHaveBeenLastCalledWith([]);
  } finally { await test.close(); }
});
