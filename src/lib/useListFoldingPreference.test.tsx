// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { listFoldingPreferenceKey, useListFoldingPreference } from "./useListFoldingPreference";

it("defaults on, remembers the setting after remount, and syncs other windows", async () => {
  localStorage.clear();
  const host = document.createElement("div"), root = createRoot(host);
  function Preview() {
    const [enabled, change] = useListFoldingPreference();
    return <input type="checkbox" checked={enabled} onChange={event => change(event.target.checked)} />;
  }
  try {
    await act(async () => root.render(<Preview />));
    expect(host.querySelector("input")!.checked).toBe(true);
    await act(async () => host.querySelector("input")!.click());
    expect(localStorage.getItem(listFoldingPreferenceKey)).toBe("false");
    await act(async () => root.render(null));
    await act(async () => root.render(<Preview />));
    expect(host.querySelector("input")!.checked).toBe(false);
    await act(async () => {
      localStorage.setItem(listFoldingPreferenceKey, "true");
      window.dispatchEvent(new StorageEvent("storage", { key: listFoldingPreferenceKey }));
    });
    expect(host.querySelector("input")!.checked).toBe(true);
  } finally { await act(async () => root.unmount()); localStorage.clear(); }
});
