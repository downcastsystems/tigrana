// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EditorOptionsSubmenu } from "./EditorOptionsSubmenu";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("opens from the keyboard, navigates choices, and returns focus on Escape", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EditorOptionsSubmenu label="Alignment"><button>Left</button><button>Center</button></EditorOptionsSubmenu>));
    const trigger = host.querySelector("button")!;
    trigger.focus();
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(document.activeElement?.textContent).toBe("Left");
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement?.textContent).toBe("Center");
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[role="menu"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("activates a choice on the first mouse click when the browser does not focus buttons", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const choose = vi.fn();
  try {
    await act(async () => root.render(<EditorOptionsSubmenu label="Algebra and geometry"><button>Quadratic formula</button><button onClick={choose}>Pythagorean theorem</button></EditorOptionsSubmenu>));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    const option = host.querySelectorAll<HTMLButtonElement>('[role="menu"] button')[1];
    await act(async () => {
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      option.dispatchEvent(down);
      // WebKit on macOS can blur the current button without focusing the clicked one.
      if (!down.defaultPrevented) (document.activeElement as HTMLElement).blur();
    });
    await act(async () => { if (option.isConnected) option.click(); });
    expect(choose).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
