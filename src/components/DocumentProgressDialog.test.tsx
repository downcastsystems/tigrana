// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { DocumentProgressDialog } from './DocumentProgressDialog';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT = true;
it('allows cancellation, protects the commit step, and displays errors', async () => {
  const shell = document.createElement('div'); shell.className = 'app-shell'; document.body.append(shell);
  const root = createRoot(shell), cancel = vi.fn(), close = vi.fn();
  const render = (status: 'running' | 'error', cancellable: boolean) => root.render(<DocumentProgressDialog state={{title:'Import document',detail:status === 'error' ? 'Document could not be read.' : 'Preparing note…',status,cancellable}} onCancel={cancel} onClose={close}/>);
  try {
    await act(async () => render('running',true));
    expect(shell.inert).toBe(true);
    await act(async () => document.querySelector('button')!.click());
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => render('running',false));
    expect(document.querySelector('button')!.disabled).toBe(true);
    await act(async () => render('error',false));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Document could not be read');
    await act(async () => document.querySelector('button')!.click());
    expect(close).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); expect(shell.inert).toBe(false); shell.remove(); }
});
