// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsMenuBar, isWindowsDesktop } from "./WindowsMenuBar";

const headings = ["Tigrana", "File", "Edit", "Find", "View", "Format", "Insert", "Window"];
const menuEntries = headings.map(id => ({ id, text: id, enabled: true, checked: null, separator: false, shortcut: null, children: [
  { id: `${id}-action`, text: `${id} action`, enabled: true, checked: null, separator: false, shortcut: "Ctrl+N", children: null },
  { id: `${id}-disabled`, text: "Unavailable", enabled: false, checked: null, separator: false, shortcut: null, children: null },
] }));

const native = vi.hoisted(() => ({
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn().mockResolvedValue(() => {}),
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  native.minimize.mockResolvedValue(undefined);
  native.toggleMaximize.mockResolvedValue(undefined);
  native.close.mockResolvedValue(undefined);
  native.isMaximized.mockResolvedValue(false);
  native.onResized.mockResolvedValue(() => {});
  native.invoke.mockImplementation(async command => command === "windows_menu_entries" ? menuEntries : undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("Windows window chrome", () => {
  it("is enabled only in native Windows windows", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    expect(isWindowsDesktop()).toBe(false);
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    expect(isWindowsDesktop()).toBe(true);
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(isWindowsDesktop()).toBe(false);
  });

  it("uses native controls and switches an open menu on hover", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onError = vi.fn();
    try {
      await act(async () => root.render(<WindowsMenuBar onError={onError} onMouseDown={() => {}} onDoubleClick={() => {}} />));
      for (const label of ["Minimize", "Maximize", "Close window"]) {
        await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
      }
      expect(native.minimize).toHaveBeenCalledOnce();
      expect(native.toggleMaximize).toHaveBeenCalledOnce();
      expect(native.close).toHaveBeenCalledOnce();
      vi.stubGlobal("devicePixelRatio", 1.5);
      const menus = Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-haspopup="menu"]'));
      expect(menus.map((button) => button.textContent)).toEqual(headings);
      await act(async () => menus[1].click());
      expect(document.querySelector('[role="menu"]')?.textContent).toContain("File action");
      await act(async () => menus[2].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      expect(menus[1].getAttribute("aria-expanded")).toBe("false");
      expect(menus[2].getAttribute("aria-expanded")).toBe("true");
      expect(document.querySelector('[role="menu"]')?.textContent).toContain("Edit action");
      const item = document.querySelector<HTMLButtonElement>('[data-menu-id="Edit-action"]')!;
      await act(async () => item.click());
      expect(native.invoke).toHaveBeenLastCalledWith("execute_windows_menu", { id: "Edit-action" });
      expect(document.querySelector('[role="menu"]')).toBeNull();
      // Hovering alone must not open a closed menu.
      await act(async () => menus[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

it("supports keyboard submenus, skips disabled items, and restores editing focus", async () => {
  const nested = { id: "nested", text: "Nested", enabled: true, checked: null, separator: false, shortcut: null, children: [
    { id: "nested-action", text: "Nested action", enabled: true, checked: null, separator: false, shortcut: null, children: null },
  ] };
  native.invoke.mockImplementation(async command => command === "windows_menu_entries" ? menuEntries.map(entry => ({ ...entry, children: [...entry.children, nested] })) : undefined);
  const host = document.createElement("div"); document.body.append(host);
  const input = document.createElement("input"); document.body.append(input);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<WindowsMenuBar onError={vi.fn()} onMouseDown={() => {}} onDoubleClick={() => {}} />));
    input.focus();
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1].click());
    expect((document.activeElement as HTMLElement).dataset.menuId).toBe("File-action");
    const key = async (key: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
    await key("ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.menuId).toBe("nested");
    await key("ArrowRight");
    expect((document.activeElement as HTMLElement).dataset.menuId).toBe("nested-action");
    await key("Escape");
    expect((document.activeElement as HTMLElement).dataset.menuId).toBe("nested");
    await key("Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(input);
  } finally { await act(async () => root.unmount()); host.remove(); input.remove(); }
});

it("ignores a pending snapshot after dismissal", async () => {
  let resolve!: (items: typeof menuEntries) => void;
  native.invoke.mockReturnValue(new Promise(done => { resolve = done; }));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<WindowsMenuBar onError={vi.fn()} onMouseDown={() => {}} onDoubleClick={() => {}} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    await act(async () => resolve(menuEntries));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('[aria-expanded="true"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
