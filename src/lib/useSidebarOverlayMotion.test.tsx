// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { sidebarSlideDuration, useSidebarOverlayMotion } from "./useSidebarOverlayMotion";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
function Harness({ side, docked = false }: { side: "left" | "right" | null; docked?: boolean }) {
  const { visibleOverlay, closing } = useSidebarOverlayMotion(side, { leftVisible: docked, outlineVisible: docked });
  return <div data-side={visibleOverlay ?? ""} data-closing={closing} />;
}
const render = async (side: "left" | "right" | null, docked = false) => act(async () => root.render(<Harness side={side} docked={docked} />));
const tick = async (ms: number) => act(async () => vi.advanceTimersByTime(ms));
const side = () => host.firstElementChild?.getAttribute("data-side");
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(["left", "right"] as const)("keeps %s mounted during the exit slide", async value => {
  await render(value); await render(null);
  expect(side()).toBe(value);
  expect(host.firstElementChild?.getAttribute("data-closing")).toBe("true");
  await tick(sidebarSlideDuration - 1); expect(side()).toBe(value);
  await tick(1); expect(side()).toBe("");
});
it("cancels stale dismissal when a sidebar reopens", async () => {
  await render("left"); await render(null); await tick(90); await render("right");
  await tick(sidebarSlideDuration); expect(side()).toBe("right");
  expect(host.firstElementChild?.getAttribute("data-closing")).toBe("false");
});
it("docks immediately without animating the docked sidebar away", async () => {
  await render("left"); await render(null, true); expect(side()).toBe("");
});
it("skips delayed removal for reduced motion", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  await render("right"); await render(null); expect(side()).toBe("");
});
