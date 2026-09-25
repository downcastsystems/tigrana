// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import BulletMethodSettings from "./BulletMethodSettings";
import { defaultBulletMethodStatuses, type BulletMethodStatus } from "../lib/bulletMethod";
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
    expect([...host.querySelectorAll("button")].find(button => button.textContent === "Save changes")!.disabled).toBe(true);
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
    expect(saved).not.toHaveBeenCalled();
    await click("Save changes");
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
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Save changes")!.click());
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
        await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Save changes")!.click());
        expect(saved.mock.lastCall![0].map((status: BulletMethodStatus) => status.prefix)).toEqual(["DONE", "TODO", "IN PROGRESS", null, "CLOSED"]);
      }
    }
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    host.remove();
  }
});
