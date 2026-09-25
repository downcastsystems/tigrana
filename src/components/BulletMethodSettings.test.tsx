// @vitest-environment jsdom
import { act, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Settings from "./BulletMethodSettings";
import { defaultBulletMethodStatuses, type BulletMethodStatus } from "../lib/bulletMethod";
// Existing configuration tests exercise the enabled controls.
function BulletMethodSettings(props: ComponentProps<typeof Settings>) {
  return <Settings {...props} display={{ replaceBullets: true, dimCompleted: true, ...props.display, enabled: true }} />;
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    expect(host.textContent).toContain("Edit → Sort Lines → Bullet Method");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Remove No status"]')!.disabled).toBe(true);
    await click("Move No status up");
    await click("Add status");
    await input("Status 4 name", "todo");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("unique");
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.prefix === "todo")).toBeUndefined();
    await input("Status 4 name", "WAITING");
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
    expect(saved.mock.lastCall![0].map((status: BulletMethodStatus) => status.prefix)).toEqual(["WAITING", "CLOSED", "TODO", null, "IN PROGRESS"]);
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
    expect(host.querySelector<HTMLInputElement>('[aria-label="Status 1 name"]')!.value).toBe("DONE");
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
      expect(names).toEqual(completion === "drop" ? ["DONE", "TODO", "IN PROGRESS", "CLOSED"] : ["CLOSED", "DONE", "TODO", "IN PROGRESS"]);
      if (completion === "drop") {
        expect(saved.mock.lastCall![0].map((status: BulletMethodStatus) => status.prefix)).toEqual(["DONE", "TODO", "IN PROGRESS", null, "CLOSED"]);
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
    expect([...boxes].map(box => box.checked)).toEqual([true, true]);
    await act(async () => boxes[0].click());
    expect(changed).toHaveBeenLastCalledWith({ enabled: true, replaceBullets: false, dimCompleted: true });
    await act(async () => boxes[1].click());
    expect(changed).toHaveBeenLastCalledWith({ enabled: true, replaceBullets: true, dimCompleted: false });
    expect(statusesChanged).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("collapses meanings and shows a bounded percentage slider only when dimming is enabled", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={vi.fn()} colorMode="dark" />));
    expect(host.querySelector('details')!.open).toBe(false);
    expect(host.querySelector('summary')!.textContent).toBe("What the default statuses mean");
    const slider = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['40', '90', '1', '70']);
    await act(async () => root.render(<BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={vi.fn()} display={{ replaceBullets: true, dimCompleted: false }} />));
    expect(host.querySelector('input[type="range"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(['light', 'dark'] as const)('restores both dimming percentages and updates the %s slider', async mode => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn();
  function Harness() {
    const [display, setDisplay] = useState({ replaceBullets: true, dimCompleted: true, lightPercent: 42, darkPercent: 51 });
    return <BulletMethodSettings statuses={defaultBulletMethodStatuses} onChange={vi.fn()} colorMode={mode} display={display}
      onDisplayChange={next => { saved(next); setDisplay(next as typeof display); }} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Restore defaults'))!.click());
    expect(saved).toHaveBeenCalledWith({ enabled: true, replaceBullets: true, dimCompleted: true, lightPercent: 65, darkPercent: 70 });
    expect(host.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe(mode === 'light' ? '65' : '70');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("starts off, hides subordinate controls, and reveals them when enabled", async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [display, setDisplay] = useState({ enabled: false, replaceBullets: true, dimCompleted: true });
    return <Settings statuses={defaultBulletMethodStatuses} onChange={vi.fn()} display={display} onDisplayChange={next => setDisplay({ ...next, enabled: Boolean(next.enabled) })} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    expect(host.querySelectorAll('.bullet-method-enable input[type="checkbox"], .bullet-method-display-options input[type="checkbox"]')).toHaveLength(1);
    expect(host.textContent).not.toContain('Select a list');
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.querySelectorAll('.bullet-method-enable input[type="checkbox"], .bullet-method-display-options input[type="checkbox"]')).toHaveLength(3);
    expect(host.textContent).toContain('Select a list');
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.querySelector('input[type="range"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(['light', 'dark'] as const)('resets only the current %s dimming value and hides the reset icon at default', async mode => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn();
  function Harness() {
    const [display, setDisplay] = useState({ enabled: true, replaceBullets: true, dimCompleted: true, lightPercent: 42, darkPercent: 51 });
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
    expect(['CLOSED', 'DONE', 'TODO', 'IN PROGRESS', 'No status'].map(name => dim(name).checked)).toEqual([true, true, false, false, false]);
    await act(async () => { dim('DONE').click(); dim('TODO').click(); });
    expect(saved).toHaveBeenCalled();
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.id === 'done').dim).toBe(false);
    expect(saved.mock.lastCall![0].find((status: BulletMethodStatus) => status.id === 'todo').dim).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Restore defaults'))!.click());
    expect(dim('DONE').checked).toBe(true);
    expect(dim('TODO').checked).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("updates the dimming label live and preserves spaces while autosaving names", async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [statuses, setStatuses] = useState<readonly BulletMethodStatus[]>(defaultBulletMethodStatuses);
    return <BulletMethodSettings statuses={statuses} onChange={setStatuses} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    const globalLabel = () => host.querySelector('.bullet-method-display-options')!.textContent;
    expect(globalLabel()).toContain('Dim CLOSED, DONE');
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Dim TODO"]')!.click());
    expect(globalLabel()).toContain('Dim CLOSED, DONE, TODO');
    const field = host.querySelector<HTMLInputElement>('[aria-label="Status 3 name"]')!;
    for (const value of ['NEXT ', 'NEXT UP']) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(field.value).toBe(value);
    }
    expect(globalLabel()).toContain('Dim CLOSED, DONE, NEXT UP');
    for (const name of ['CLOSED', 'DONE', 'NEXT UP']) await act(async () => host.querySelector<HTMLInputElement>(`[aria-label="Dim ${name}"]`)!.click());
    expect(globalLabel()).toContain('none selected');
    expect([...host.querySelectorAll('button')].some(button => /Save changes|Discard changes/.test(button.textContent ?? ''))).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
