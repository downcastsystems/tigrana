// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: vi.fn(), lookup: vi.fn(), create: vi.fn() }));
vi.mock("./desktop", () => ({ isTauri: mocks.native }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: Object.assign(function(label: string, options: unknown) {
    mocks.create(label, options);
    return { once: async (event: string, callback: () => void) => { if (event === "tauri://created") queueMicrotask(callback); return () => {}; } };
  }, { getByLabel: mocks.lookup }),
}));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); document.documentElement.dataset.theme = "dark"; });
afterEach(() => { vi.restoreAllMocks(); });
it("opens a standalone desktop reference and coalesces repeated clicks", async () => {
  mocks.native.mockReturnValue(true); mocks.lookup.mockResolvedValue(null);
  const { openThemeReferenceWindow } = await import("./themeReferenceWindow");
  await Promise.all([openThemeReferenceWindow(), openThemeReferenceWindow()]);
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create).toHaveBeenCalledWith("tigrana-css-reference", expect.objectContaining({ url: "/?view=theme-css-reference&mode=dark", resizable: true, decorations: true }));
});
it("restores and focuses an existing desktop reference", async () => {
  mocks.native.mockReturnValue(true);
  const existing = { unminimize: vi.fn(), show: vi.fn(), setFocus: vi.fn() };
  mocks.lookup.mockResolvedValue(existing);
  const { openThemeReferenceWindow } = await import("./themeReferenceWindow");
  await openThemeReferenceWindow();
  expect(existing.unminimize).toHaveBeenCalledOnce();
  expect(existing.show).toHaveBeenCalledOnce();
  expect(existing.setFocus).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("reuses the browser popup without navigating the editor", async () => {
  mocks.native.mockReturnValue(false);
  const popup = { closed: false, focus: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  const { openThemeReferenceWindow } = await import("./themeReferenceWindow");
  await openThemeReferenceWindow(); await openThemeReferenceWindow();
  expect(open).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith(expect.stringContaining("view=theme-css-reference"), "tigrana-css-reference", expect.stringContaining("popup"));
  expect(popup.focus).toHaveBeenCalledOnce();
});
it("reports blocked browser popups", async () => {
  mocks.native.mockReturnValue(false); vi.spyOn(window, "open").mockReturnValue(null);
  const { openThemeReferenceWindow } = await import("./themeReferenceWindow");
  await expect(openThemeReferenceWindow()).rejects.toThrow("Allow pop-up windows");
});
