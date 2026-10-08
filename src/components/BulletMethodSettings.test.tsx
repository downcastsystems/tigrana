// @vitest-environment jsdom
import { act, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Settings from "./BulletMethodSettings";
import { defaultBulletMethodStatuses, type BulletMethodStatus } from "../lib/bulletMethod";
// Existing configuration tests exercise the enabled controls.
function BulletMethodSettings(props: ComponentProps<typeof Settings>) {
  return <Settings {...props} display={{ replaceBullets: true, ...props.display, enabled: true }} />;
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("connects shortcut errors to their fields and clears them when corrected", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn();
  const field = (name: string) => host.querySelector<HTMLInputElement>(`[aria-label="Shortcut for ${name}"]`)!;
  const input = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field("QUESTION"), value);
    field("QUESTION").dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={saved} />));
    for (const value of ["?", "has space:", "123456789:", "-:", "::"]) {
      await input(value);
      const shortcut = field("QUESTION");
      expect(shortcut.getAttribute("aria-invalid")).toBe("true");
      const error = document.getElementById(shortcut.getAttribute("aria-describedby")!);
      expect(error?.getAttribute("role")).toBe("alert");
      expect(error?.closest("li")).toBe(shortcut.closest("li"));
      expect(host.querySelector('.bullet-status-transfer + [role="alert"]')).toBeNull();
      expect(saved).not.toHaveBeenCalled();
    }
    expect(field("TODO").getAttribute("aria-invalid")).toBe("true");
    await input(":!");
    expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(field("QUESTION").hasAttribute("aria-describedby")).toBe(false);
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.id === "question").shortcut).toBe(":!");
    await input("");
    expect(field("QUESTION").getAttribute("aria-invalid")).toBe("false");
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.id === "question").shortcut).toBe("");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("explains cycle direction and saves Cycle choices independently of Dim and Celebrate", async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const saved = vi.fn();
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={saved} />));
    expect(host.textContent).toContain('bottom to top');
    const cycle = (name: string) => host.querySelector<HTMLInputElement>(`[aria-label="Cycle ${name}"]`)!;
    expect(['QUESTION', 'CLOSED', 'DONE', 'IN PROGRESS', 'TODO'].map(name => cycle(name).checked)).toEqual([true, true, true, true, true]);
    expect(cycle('No status')).toBeNull();
    expect(host.querySelector('[aria-label="Cycling unavailable for No status"]')?.textContent).toBe('—');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Shortcut for QUESTION"]')!.value).toBe('?:');
    await act(async () => cycle('DONE').click());
    expect(saved.mock.lastCall![0].find((s: BulletMethodStatus) => s.id === 'done').cycle).toBe(false);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Dim DONE"]')!.checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Celebrate DONE"]')!.checked).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Restore defaults'))!.click());
    expect(cycle('DONE').checked).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

it("edits, validates, reorders by buttons and drag, removes, saves and restores defaults", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn();
  function Harness() {
    const [statuses, setStatuses] = useState<readonly BulletMethodStatus[]>(defaultBulletMethodStatuses);
    return <BulletMethodSettings statuses={statuses} onChange={next => { saved(next); setStatuses(next); }} />;
  }
  const click = async (label: string) => act(async () => {
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label || button.getAttribute("aria-label") === label);
    expect(button).toBeDefined(); button!.click();
  });
  const input = async (label: string, value: string) => act(async () => {
    const field = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    expect(field).not.toBeNull();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(<Harness />));
    expect(host.textContent).toContain("Inside a list, choose Edit -> Sort Lines -> Bullet Statuses to sort by the status.");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Remove No status"]')!.disabled).toBe(true);
    await click("Move No status up");
    await click("Add status");
    await input("Status 5 name", "todo");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("unique");
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.prefix === "todo")).toBeUndefined();
    await input("Status 5 name", "WAITING");
    expect(host.querySelector('input[aria-label$=" meaning"]')).toBeNull();
    // Native WebKit may take over HTML drag/drop. Reordering must work from
    // pointer events alone, including drops over an editable status field.
    const destination = host.querySelector<HTMLInputElement>('[aria-label="Status 1 name"]')!;
    const row = destination.closest("li")!;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100 } as DOMRect);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => destination) });
    const pointer = async (target: EventTarget, type: string, y: number) => act(async () => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 1 }); target.dispatchEvent(event);
    });
    const grip = host.querySelector('[aria-label="Drag WAITING to reorder"]')!;
    expect(grip.getAttribute("draggable")).not.toBe("true");
    await pointer(grip, "pointerdown", 200);
    await pointer(window, "pointermove", 20);
    await pointer(window, "pointerup", 20);
    await click("Remove DONE");
    expect(saved).toHaveBeenCalled();
    await click("Icon for CLOSED");
    await click("circle-x");
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.id === "closed").icon).toBe("x");
    expect(saved.mock.lastCall![0].map((status: BulletMethodStatus) => status.prefix)).toEqual(["WAITING", "CLOSED", "IN PROGRESS", "TODO", null, "QUESTION"]);
    await click("Restore defaults");
    expect(saved.mock.lastCall![0]).toEqual(defaultBulletMethodStatuses);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Status 1 name"]')!.value).toBe("CLOSED");
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});

it("keeps edits available when saving fails", async () => {
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={() => { throw new Error("Storage full"); }} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Move CLOSED down"]')!.click());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not save");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Status 2 name"]')!.value).toBe("CLOSED");
  } finally { await act(async () => root.unmount()); }
});


it.each(["drop", "pointercancel", "blur", "unmount", "outside", "click"])("handles pointer gesture completion: %s", async completion => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); let unmounted = false;
  const saved = vi.fn();
  const pointer = async (target: EventTarget, type: string, y: number) => act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 }); target.dispatchEvent(event);
  });
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={saved} />));
    const target = host.querySelector('.bullet-method-unmarked')!;
    vi.spyOn(target.closest("li")!, "getBoundingClientRect").mockReturnValue({ top: 400, height: 100 } as DOMRect);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => completion === "outside" ? document.body : target) });
    await pointer(host.querySelector('[aria-label="Drag CLOSED to reorder"]')!, "pointerdown", 20);
    if (completion !== "click") await pointer(window, "pointermove", 480);
    if (completion === "pointercancel") await pointer(window, "pointercancel", 480);
    if (completion === "blur") await act(async () => { window.dispatchEvent(new Event("blur")); });
    if (completion === "unmount") { await act(async () => root.unmount()); unmounted = true; }
    await pointer(window, "pointerup", completion === "click" ? 20 : 480);
    expect(document.body.classList.contains("is-dragging-bullet-status")).toBe(false);
    if (!unmounted) {
      const names = [...host.querySelectorAll<HTMLInputElement>('input[aria-label$=" name"]')].map(input => input.value);
      expect(names).toEqual(completion === "drop" ? ["DONE", "IN PROGRESS", "TODO", "QUESTION", "CLOSED"] : ["CLOSED", "DONE", "IN PROGRESS", "TODO", "QUESTION"]);
      if (completion === "drop") {
        expect(saved.mock.lastCall![0].map((status: BulletMethodStatus) => status.prefix)).toEqual(["DONE", "IN PROGRESS", "TODO", "QUESTION", null, "CLOSED"]);
      }
    }
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    host.remove();
  }
});

it("applies display toggles immediately without changing status drafts", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const changed = vi.fn(), statusesChanged = vi.fn();
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={statusesChanged} onDisplayChange={changed} />));
    const boxes = host.querySelectorAll<HTMLInputElement>('.bullet-method-display-options input[type="checkbox"]');
    expect([...boxes].map(box => box.checked)).toEqual([true, true, true, false, true, true, true]);
    await act(async () => boxes[0].click());
    expect(changed).toHaveBeenLastCalledWith({ enabled: true, replaceBullets: false });
    await act(async () => boxes[1].click());
    expect(changed).toHaveBeenLastCalledWith({ enabled: true, replaceBullets: true, shortcutsEnabled: false });
    await act(async () => boxes[2].click());
    expect(changed).toHaveBeenLastCalledWith({ enabled: true, replaceBullets: true, autoSortOnClick: false });
    await act(async () => boxes[3].click());
    expect(changed).toHaveBeenLastCalledWith({ enabled: true, replaceBullets: true, autoCollapseDone: true });
    expect(statusesChanged).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps a labeled percentage slider available even when no statuses are dimmed", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={vi.fn()} colorMode="dark" />));
    expect(host.querySelector('details')!.open).toBe(false);
    expect(host.querySelector('summary')!.textContent).toBe("What the default statuses mean");
    const slider = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['40', '90', '1', '70']);
    await act(async () => root.render(<BulletMethodSettings onChange={vi.fn()} statuses={defaultBulletMethodStatuses.map(status => ({ ...status, dim: false }))} display={{ replaceBullets: true }} />));
    expect(host.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('65');
    expect(host.querySelector('.bullet-method-dim-slider')!.textContent).toContain('Status dimming (light mode)');
    expect(host.textContent).not.toContain('Automatically bold the status and colon');
    expect(host.textContent).not.toContain('Dim CLOSED, DONE');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(['light', 'dark'] as const)('restores both dimming percentages and updates the %s slider', async mode => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn();
  function Harness() {
    const [display, setDisplay] = useState({ replaceBullets: true, lightPercent: 42, darkPercent: 51 });
    return <BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={vi.fn()} colorMode={mode} display={display}
      onDisplayChange={next => { saved(next); setDisplay(next as typeof display); }} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Restore defaults'))!.click());
    expect(saved).toHaveBeenCalledWith({ enabled: true, replaceBullets: true, lightPercent: 65, darkPercent: 70, boldStatusesEnabled: true, dimmedStatusesEnabled: true, celebrationsEnabled: true });
    expect(host.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe(mode === 'light' ? '65' : '70');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("starts off, hides subordinate controls, and reveals them when enabled", async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [display, setDisplay] = useState({ enabled: false, replaceBullets: true });
    return <Settings statuses={defaultBulletMethodStatuses} onChange={vi.fn()} display={display} onDisplayChange={next => setDisplay({ ...next, enabled: Boolean(next.enabled) })} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    expect(host.querySelectorAll('.bullet-method-enable input[type="checkbox"], .bullet-method-display-options input[type="checkbox"]')).toHaveLength(1);
    expect(host.textContent).not.toContain('Inside a list');
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.querySelectorAll('.bullet-method-enable input[type="checkbox"], .bullet-method-display-options input[type="checkbox"]')).toHaveLength(8);
    expect(host.textContent).toContain('Inside a list');
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.querySelector('input[type="range"]')).toBeNull();
    expect(host.textContent).not.toContain('Automatically bold the status and colon');
    expect(host.textContent).not.toContain('Dim CLOSED, DONE');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(['light', 'dark'] as const)('resets only the current %s dimming value and hides the reset icon at default', async mode => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn();
  function Harness() {
    const [display, setDisplay] = useState({ enabled: true, replaceBullets: true, lightPercent: 42, darkPercent: 51 });
    return <BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={vi.fn()} colorMode={mode} display={display}
      onDisplayChange={next => { saved(next); setDisplay(next as typeof display); }} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    const selector = `button[aria-label="Reset ${mode} dimming to default"]`;
    expect(host.querySelector(selector)).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
    expect(saved.mock.lastCall![0]).toMatchObject(mode === 'light' ? { lightPercent: 65, darkPercent: 51 } : { lightPercent: 42, darkPercent: 70 });
    expect(host.querySelector(selector)).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe(mode === 'light' ? '65' : '70');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("automatically saves per-status dim choices and restores their defaults", async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn();
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={saved} />));
    const dim = (name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="Dim ${name}"]`)!;
    expect(['CLOSED', 'DONE', 'TODO', 'IN PROGRESS'].map(name => dim(name).checked)).toEqual([true, true, false, false]);
    expect(dim('No status')).toBeNull();
    expect(host.querySelector('[aria-label="Dimming unavailable for No status"]')?.textContent).toBe('—');
    await act(async () => { dim('DONE').click(); dim('TODO').click(); });
    expect(saved).toHaveBeenCalled();
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.id === 'done').dim).toBe(false);
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.id === 'todo').dim).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Restore defaults'))!.click());
    expect(dim('DONE').checked).toBe(true);
    expect(dim('TODO').checked).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("automatically saves per-status celebration choices and restores their defaults", async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn();
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={saved} />));
    const celebrate = (name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="Celebrate ${name}"]`)!;
    expect(['CLOSED', 'DONE', 'TODO', 'IN PROGRESS'].map(name => celebrate(name).checked)).toEqual([false, true, false, false]);
    expect(celebrate('No status')).toBeNull();
    expect(host.querySelector('[aria-label="Celebration unavailable for No status"]')?.textContent).toBe('—');
    await act(async () => { celebrate('DONE').click(); celebrate('TODO').click(); });
    expect(saved).toHaveBeenCalled();
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.id === 'done').celebrate).toBe(false);
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.id === 'todo').celebrate).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Restore defaults'))!.click());
    expect(celebrate('DONE').checked).toBe(true);
    expect(celebrate('TODO').checked).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("preserves per-status dim choices and spaces while autosaving names", async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [statuses, setStatuses] = useState<readonly BulletMethodStatus[]>(defaultBulletMethodStatuses);
    return <BulletMethodSettings statuses={statuses} onChange={setStatuses} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Dim TODO"]')!.click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Dim TODO"]')!.checked).toBe(true);
    const field = host.querySelector<HTMLInputElement>('[aria-label="Status 4 name"]')!;
    for (const value of ['NEXT ', 'NEXT UP']) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(field.value).toBe(value);
    }
    expect(host.querySelector<HTMLInputElement>('[aria-label="Dim NEXT UP"]')!.checked).toBe(true);
    for (const name of ['CLOSED', 'DONE', 'NEXT UP']) await act(async () => host.querySelector<HTMLInputElement>(`[aria-label="Dim ${name}"]`)!.click());
    expect(['CLOSED', 'DONE', 'NEXT UP'].map(name => host.querySelector<HTMLInputElement>(`[aria-label="Dim ${name}"]`)!.checked)).toEqual([false, false, false]);
    expect(host.querySelector('input[type="range"]')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some(button => /Save changes|Discard changes/.test(button.textContent ?? ''))).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('imports only status rows and restores the original system afterward', async () => {
  const { encodeBulletStatusSystem } = await import('../lib/bulletStatusSystem');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn(), displayChanged = vi.fn();
  const imported = [...defaultBulletMethodStatuses].reverse().map(s => ({ ...s, dim: false }));
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={saved} onDisplayChange={displayChanged} />));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 100, text: async () => encodeBulletStatusSystem(imported) }] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(saved.mock.lastCall![0].map((s: BulletMethodStatus) => s.id)).toEqual(imported.map(s => s.id));
    expect(saved.mock.lastCall![0].every((s: BulletMethodStatus) => s.dim === false)).toBe(true);
    expect(displayChanged).not.toHaveBeenCalled();
    const calls = saved.mock.calls.length;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 10, text: async () => '{}' }] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(saved).toHaveBeenCalledTimes(calls);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('supported');
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Restore defaults'))!.click());
    expect(saved.mock.lastCall![0]).toEqual(defaultBulletMethodStatuses);
  } finally { await act(async () => root.unmount()); host.remove(); }
});


it("defaults Bold by status identity, saves it independently, and restores defaults", async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const changed = vi.fn();
  const bold = (name: string) => host.querySelector<HTMLInputElement>(`[aria-label="Bold ${name}"]`)!;
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={changed} />));
    expect(host.querySelector('.bullet-method-column-headings')!.textContent).toContain('BoldDim');
    expect(['CLOSED', 'DONE', 'IN PROGRESS', 'TODO', 'QUESTION'].map(name => bold(name).checked)).toEqual([false, false, true, true, true]);
    expect(host.querySelector('[aria-label="Bolding unavailable for No status"]')!.textContent).toBe('—');
    await act(async () => bold('DONE').click());
    expect(changed.mock.lastCall![0].find((s: BulletMethodStatus) => s.id === 'done')).toMatchObject({ bold: true });
    expect(host.querySelector<HTMLInputElement>('[aria-label="Dim DONE"]')!.checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Celebrate DONE"]')!.checked).toBe(true);
    await act(async () => bold('TODO').click());
    expect(changed.mock.lastCall![0].find((s: BulletMethodStatus) => s.id === 'todo')).toMatchObject({ bold: false });
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Restore defaults'))!.click());
    expect(['CLOSED', 'DONE', 'IN PROGRESS', 'TODO', 'QUESTION'].map(name => bold(name).checked)).toEqual([false, false, true, true, true]);
    expect(host.textContent).not.toContain('Include dimmed statuses when bolding automatically');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each([
  ['Enable bold statuses', 'Bold', 'boldStatusesEnabled'],
  ['Enable dimmed statuses', 'Dim', 'dimmedStatusesEnabled'],
  ['Enable celebrations', 'Celebrate', 'celebrationsEnabled'],
] as const)("disables the %s column while preserving its row choices", async (label, column, flag) => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), changed = vi.fn(), displayChanged = vi.fn();
  function Harness() {
    const [display, setDisplay] = useState<import('../lib/bulletMethod').BulletMethodDisplay>({ enabled: true, replaceBullets: true });
    return <Settings statuses={defaultBulletMethodStatuses} onChange={changed} display={display}
      onDisplayChange={next => { displayChanged(next); setDisplay(next); }} />;
  }
  const rows = () => [...host.querySelectorAll<HTMLInputElement>(`input[aria-label^="${column} "]`)];
  const master = () => [...host.querySelectorAll<HTMLInputElement>('.bullet-method-display-options input[type="checkbox"]')].find(input => input.parentElement!.textContent!.trim() === label)!;
  try {
    await act(async () => root.render(<Harness />));
    const choices = rows().map(input => input.checked);
    expect(master().checked).toBe(true);
    expect(rows().every(input => !input.disabled)).toBe(true);
    await act(async () => master().click());
    expect(displayChanged.mock.lastCall![0][flag]).toBe(false);
    expect(rows().every(input => input.disabled && input.parentElement!.classList.contains('is-disabled'))).toBe(true);
    expect(rows().map(input => input.checked)).toEqual(choices);
    expect([...host.querySelectorAll('.bullet-method-column-headings span')].find(span => span.textContent === column)!.classList.contains('is-disabled')).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Cycle DONE"]')!.disabled).toBe(false);
    if (column === 'Dim') expect(host.querySelector<HTMLInputElement>('input[type="range"]')!.disabled).toBe(true);
    await act(async () => rows()[0].click());
    expect(changed).not.toHaveBeenCalled();
    await act(async () => master().click());
    expect(rows().every(input => !input.disabled)).toBe(true);
    expect(rows().map(input => input.checked)).toEqual(choices);
    expect(changed).not.toHaveBeenCalled();
    if (column === 'Dim') expect(host.querySelector<HTMLInputElement>('input[type="range"]')!.disabled).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
