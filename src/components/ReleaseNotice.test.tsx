// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReleaseNotice } from "./ReleaseNotice";
import { RELEASE_DISMISSED_KEY } from "../lib/releaseUpdates";

const mocks = vi.hoisted(() => ({ native: vi.fn(), check: vi.fn(), open: vi.fn() }));
vi.mock("../lib/desktop", () => ({ isTauri: mocks.native, openExternal: mocks.open }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.0.6" }));
vi.mock("../lib/releaseUpdates", async (original) => ({
  ...await original<typeof import("../lib/releaseUpdates")>(), checkForRelease: mocks.check,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  mocks.native.mockReturnValue(true);
  mocks.check.mockResolvedValue({ version: "1.0.7", url: "https://github.com/downcastsystems/tigrana/releases/tag/v1.0.7" });
  mocks.open.mockResolvedValue(undefined);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("announces an update, opens its release page, and remembers dismissal", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReleaseNotice />));
    expect(host.textContent).toBe("");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.check).toHaveBeenCalledWith("1.0.6");
    expect(host.textContent).toContain("Update 1.0.7");
    await act(async () => host.querySelector<HTMLButtonElement>(".release-notice-link")!.click());
    expect(mocks.open).toHaveBeenCalledWith("https://github.com/downcastsystems/tigrana/releases/tag/v1.0.7");
    await act(async () => host.querySelector<HTMLButtonElement>(".release-notice-dismiss")!.click());
    expect(localStorage.getItem(RELEASE_DISMISSED_KEY)).toBe("1.0.7");
    expect(host.textContent).toBe("");
    mocks.check.mockResolvedValue({ version: "1.0.8", url: "https://github.com/downcastsystems/tigrana/releases/tag/v1.0.8" });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toContain("Update 1.0.8");
  } finally { await act(async () => root.unmount()); }
});

it("does not check from the browser demo", async () => {
  mocks.native.mockReturnValue(false);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<ReleaseNotice />));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.check).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
