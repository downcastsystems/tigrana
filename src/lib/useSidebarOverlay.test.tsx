// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSidebarOverlay } from "./useSidebarOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
function Harness({ docked = false }: { docked?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { overlay, hoverSide, hoverDelay, hoverOffset, hoverRevision, setOverlay } = useSidebarOverlay(ref, { leftVisible: docked, outlineVisible: docked });
  return <div ref={ref} data-overlay={overlay ?? ""} data-hover={hoverSide ?? ""} data-delay={hoverDelay} data-offset={hoverOffset} data-revision={hoverRevision}>
    <div data-sidebar-peek="left" /> <div data-sidebar-peek="right" />
    <div data-sidebar-peek="left" data-sidebar-peek-edge />
    <main />
    <button onClick={() => setOverlay(null)}>Close</button>
    <button data-manual-left onClick={() => setOverlay("left")}>Manual</button>
    <button data-manual-right onClick={() => setOverlay("right")}>Open right</button>
    {overlay && <aside id={overlay === "left" ? "left-navigation-panes" : "right-note-sidebar"}><input /></aside>}
  </div>;
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const move = async (selector: string, pointerType = "mouse") => act(async () => {
  const event = new MouseEvent("pointermove", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  host.querySelector(selector)!.dispatchEvent(event);
});
const tick = async (ms: number) => act(async () => vi.advanceTimersByTime(ms));
const visible = () => host.firstElementChild?.getAttribute("data-overlay");
const charging = () => host.firstElementChild?.getAttribute("data-hover");

it.each([
  { side: "left", selector: '[data-sidebar-peek="left"]', delay: 1000 },
  { side: "right", selector: '[data-sidebar-peek="right"]', delay: 1000 },
  { side: "left", selector: '[data-sidebar-peek-edge]', delay: 250 },
])("previews $selector after $delay ms and closes after leaving", async ({ side, selector, delay }) => {
  await move(selector);
  expect(charging()).toBe(side);
  expect(host.firstElementChild?.getAttribute('data-delay')).toBe(String(delay));
  await tick(delay - 1); expect(visible()).toBe("");
  expect(charging()).toBe(side);
  await tick(1); expect(visible()).toBe(side);
  expect(charging()).toBe("");
  await move("aside"); await tick(2000); expect(visible()).toBe(side);
  await move("main"); await tick(299); expect(visible()).toBe(side);
  await move("aside"); await tick(1); expect(visible()).toBe(side);
  await move("main"); await tick(300); expect(visible()).toBe("");
});
it("cancels brief hovers and restarts the delay when moving to the opposite edge", async () => {
  await move('[data-sidebar-peek="left"]'); await tick(200);
  await move("main"); expect(charging()).toBe(""); await tick(300); expect(visible()).toBe("");
  await move('[data-sidebar-peek="left"]'); await tick(200);
  await move('[data-sidebar-peek="right"]'); expect(charging()).toBe("right"); await tick(100); expect(visible()).toBe("");
  await tick(899); expect(visible()).toBe("");
  await tick(1); expect(visible()).toBe("right");
});
it("ignores touch and docked panes", async () => {
  await move('[data-sidebar-peek="left"]', "touch"); await tick(1100); expect(visible()).toBe("");
  expect(charging()).toBe("");
  await act(async () => root.render(<Harness docked />));
  await move('[data-sidebar-peek="right"]'); await tick(1100); expect(visible()).toBe("");
  expect(charging()).toBe("");
});
it("cancels pending hover on explicit dismissal and leaves manual overlays open", async () => {
  await move('[data-sidebar-peek="left"]'); await tick(200);
  await act(async () => host.querySelector('button')!.click());
  await tick(300); expect(visible()).toBe("");
  await act(async () => host.querySelectorAll('button')[1].click());
  await move('main'); await tick(2000); expect(visible()).toBe("left");
  await act(async () => window.dispatchEvent(new Event('blur'))); expect(visible()).toBe("");
});
it("keeps a preview open while a sidebar field is being edited", async () => {
  await move('[data-sidebar-peek="right"]'); await tick(1000);
  await act(async () => host.querySelector('input')!.focus());
  await move('main'); await tick(300); expect(visible()).toBe('right');
  await act(async () => host.querySelector('input')!.blur());
  await move('main'); await tick(300); expect(visible()).toBe('');
});

it("cancels pending previews when a pointer presses down to interact or drag", async () => {
  await move('[data-sidebar-peek="right"]'); await tick(200);
  await act(async () => host.querySelector('main')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  expect(charging()).toBe('');
  await tick(1000); expect(visible()).toBe('');
});

it("keeps the scrollbar edge inert while retaining left-edge and right-toggle previews", async () => {
  vi.spyOn(host.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 900, width: 900 } as DOMRect);
  await act(async () => host.querySelector('main')!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 895 })));
  await tick(1000); expect(visible()).toBe('');
  expect(charging()).toBe('');
  await act(async () => host.querySelector('main')!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5 })));
  await tick(384); expect(visible()).toBe('left');
  await act(async () => host.querySelector('button')!.click());
  await move('[data-sidebar-peek="right"]');
  await tick(1000); expect(visible()).toBe('right');
});

it.each(['left', 'right'])("opens the %s pane immediately on click during its hover delay", async side => {
  await move(`[data-sidebar-peek="${side}"]`); await tick(400);
  expect(visible()).toBe('');
  const button = host.querySelector<HTMLButtonElement>(`[data-manual-${side}]`)!;
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    button.click();
  });
  expect(visible()).toBe(side);
  expect(charging()).toBe('');
  await tick(1000); expect(visible()).toBe(side);
});

it("restarts the timer and glow when moving between the left edge and button", async () => {
  await move('[data-sidebar-peek-edge]'); await tick(200);
  await move('[data-sidebar-peek="left"]');
  expect(host.firstElementChild?.getAttribute('data-delay')).toBe('1000');
  await tick(999); expect(visible()).toBe('');
  await tick(1); expect(visible()).toBe('left');
  await act(async () => host.querySelector('button')!.click());
  await move('[data-sidebar-peek="left"]'); await tick(800);
  await move('[data-sidebar-peek-edge]');
  expect(host.firstElementChild?.getAttribute('data-delay')).toBe('250');
  await tick(249); expect(visible()).toBe('');
  await tick(1); expect(visible()).toBe('left');
});

it("cancels hover feedback on window exit, focus loss, and docking", async () => {
  await move('[data-sidebar-peek="left"]');
  await act(async () => document.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })));
  expect(charging()).toBe('');
  await tick(300); expect(visible()).toBe('');
  await move('[data-sidebar-peek="right"]');
  await act(async () => window.dispatchEvent(new Event('blur')));
  expect(charging()).toBe('');
  await move('[data-sidebar-peek="left"]');
  await act(async () => root.render(<Harness docked />));
  expect(charging()).toBe('');
  await tick(300); expect(visible()).toBe('');
});

function modal(kind: 'settings' | 'backdrop' | 'native') {
  const wrapper = document.createElement('div');
  const element = document.createElement(kind === 'native' ? 'dialog' : 'section');
  if (kind === 'settings') { element.setAttribute('role', 'dialog'); element.setAttribute('aria-modal', 'true'); }
  if (kind === 'backdrop') element.className = 'dialog-backdrop';
  if (kind === 'native') element.setAttribute('open', '');
  wrapper.appendChild(element);
  return { wrapper, element };
}

it.each(['settings', 'backdrop', 'native'] as const)('blocks all hover targets while a %s modal is open', async kind => {
  const { wrapper } = modal(kind);
  try {
    await act(async () => document.body.appendChild(wrapper));
    for (const target of ['[data-sidebar-peek-edge]', '[data-sidebar-peek="left"]', '[data-sidebar-peek="right"]']) {
      await move(target);
      expect(charging()).toBe('');
      await tick(1100); expect(visible()).toBe('');
    }
    await act(async () => wrapper.remove());
    await tick(1100); expect(visible()).toBe('');
    await move('[data-sidebar-peek-edge]'); await tick(300);
    expect(visible()).toBe('left');
  } finally { wrapper.remove(); }
});

it.each([false, true])('dismisses a pending or open hover preview when a modal appears (open: %s)', async opened => {
  await move('[data-sidebar-peek="right"]');
  await tick(opened ? 1000 : 400);
  const { wrapper } = modal('settings');
  try {
    await act(async () => document.body.appendChild(wrapper));
    expect(charging()).toBe('');
    expect(visible()).toBe('');
    await tick(1500); expect(visible()).toBe('');
  } finally { wrapper.remove(); }
});

it('cancels a hover when an existing native dialog opens', async () => {
  const { wrapper, element } = modal('native'); element.removeAttribute('open');
  try {
    await act(async () => document.body.appendChild(wrapper));
    await move('[data-sidebar-peek-edge]'); expect(charging()).toBe('left');
    await act(async () => element.setAttribute('open', ''));
    expect(charging()).toBe('');
    await tick(300); expect(visible()).toBe('');
  } finally { wrapper.remove(); }
});

it('allows hovering with a nonmodal popover open', async () => {
  const { wrapper, element } = modal('settings'); element.setAttribute('aria-modal', 'false');
  try {
    await act(async () => document.body.appendChild(wrapper));
    await move('[data-sidebar-peek-edge]'); await tick(300);
    expect(visible()).toBe('left');
  } finally { wrapper.remove(); }
});

const moveAt = async (x: number) => act(async () => {
  host.querySelector('main')!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x }));
});
function measureFrame(left = 0) {
  vi.spyOn(host.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ left, right: left + 900, width: 900 } as DOMRect);
}

it.each([{ x: 0, delay: 250 }, { x: 14, delay: 625 }, { x: 28, delay: 1000 }])(
  'charges in $delay ms when stationary $x px from the left edge', async ({ x, delay }) => {
    measureFrame(20);
    await moveAt(20 + x);
    expect(charging()).toBe('left');
    expect(host.firstElementChild?.getAttribute('data-delay')).toBe(String(delay));
    await tick(delay - 1); expect(visible()).toBe('');
    await tick(1); expect(visible()).toBe('left');
  },
);

it('uses the 28 px region and cancels beyond either boundary', async () => {
  measureFrame(20);
  await moveAt(47); expect(charging()).toBe('left');
  await moveAt(49); expect(charging()).toBe('');
  await tick(1100); expect(visible()).toBe('');
  await moveAt(20); expect(charging()).toBe('left');
  await moveAt(19); expect(charging()).toBe('');
  await tick(1100); expect(visible()).toBe('');
});

it('accelerates the remaining charge without jumping the glow or restarting progress', async () => {
  measureFrame();
  await moveAt(28); await tick(400); // 40% at the slow edge.
  await moveAt(0);
  expect(host.firstElementChild?.getAttribute('data-delay')).toBe('250');
  expect(Number(host.firstElementChild?.getAttribute('data-offset'))).toBeCloseTo(-100); // Same 40% of 250ms.
  await tick(149); expect(visible()).toBe('');
  await tick(1); expect(visible()).toBe('left');
});

it('slows the remaining charge when moving away without losing progress', async () => {
  measureFrame();
  await moveAt(0); await tick(100); // 40% at the fast edge.
  await moveAt(28);
  expect(Number(host.firstElementChild?.getAttribute('data-offset'))).toBeCloseTo(-400);
  await tick(599); expect(visible()).toBe('');
  await tick(1); expect(visible()).toBe('left');
});

it('does not restart for repeated events at the same distance', async () => {
  measureFrame();
  await moveAt(14);
  const revision = host.firstElementChild?.getAttribute('data-revision');
  for (let i = 0; i < 6; i++) {
    await tick(100); await moveAt(14);
    expect(host.firstElementChild?.getAttribute('data-revision')).toBe(revision);
  }
  await tick(24); expect(visible()).toBe('');
  await tick(1); expect(visible()).toBe('left');
});

it('maintains one pending open through rapid changes and never reopens after dismissal', async () => {
  measureFrame();
  for (let i = 0; i < 20; i++) {
    await moveAt(i % 2 ? 0 : 28); await tick(5);
    expect(vi.getTimerCount()).toBe(1);
  }
  await tick(1000); expect(visible()).toBe('left');
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => host.querySelector('button')!.click());
  await tick(2000); expect(visible()).toBe('');
});
