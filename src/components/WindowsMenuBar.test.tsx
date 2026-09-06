// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsMenuBar, isWindowsDesktop } from "./WindowsMenuBar";

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
  native.invoke.mockResolvedValue(undefined);
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

  it("uses native controls and opens menus in physical pixels", async () => {
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
      const file = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "File")!;
      vi.spyOn(file, "getBoundingClientRect").mockReturnValue({ left: 40, bottom: 32 } as DOMRect);
      vi.stubGlobal("devicePixelRatio", 1.5);
      await act(async () => file.click());
      expect(native.invoke).toHaveBeenCalledWith("popup_windows_menu", { menu: "File", x: 60, y: 48 });
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
