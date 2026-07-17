// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { EditorTopbar } = await import("./App");

describe("Editor topbar", () => {
  const containers: HTMLElement[] = [];

  afterEach(() => {
    containers.splice(0).forEach((container) => container.remove());
  });

  it("places the sidebar controls at the outer edges of the editor actions", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    const onToggleLeft = vi.fn();
    const onToggleOutline = vi.fn();
    const onTitleClick = vi.fn();

    await act(async () => {
      root.render(
        <EditorTopbar
          animateTitle
          leftVisible
          outlineVisible
          title="A very long note title"
          titleVisible
          onTitleClick={onTitleClick}
          onToggleLeft={onToggleLeft}
          onToggleOutline={onToggleOutline}
        >
          <button type="button">Find</button>
          <button type="button">Width</button>
        </EditorTopbar>,
      );
    });

    const topbar = container.querySelector(".topbar");
    const actions = container.querySelector(".topbar-actions");
    const dockedTitle = container.querySelector(".topbar-note-title");
    const leftToggle = container.querySelector<HTMLButtonElement>(".sidebar-toggle");
    const rightToggle = container.querySelector<HTMLButtonElement>(".outline-toggle");

    expect(topbar?.firstElementChild).toBe(leftToggle);
    expect(leftToggle?.nextElementSibling).toBe(dockedTitle);
    expect(topbar?.lastElementChild).toBe(actions);
    expect(actions?.lastElementChild).toBe(rightToggle);
    expect(dockedTitle?.classList.contains("is-visible")).toBe(true);
    expect(dockedTitle?.classList.contains("is-animated")).toBe(true);
    expect(dockedTitle?.getAttribute("aria-hidden")).toBe("false");
    expect(dockedTitle?.getAttribute("tabindex")).toBe("0");
    expect(leftToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(rightToggle?.getAttribute("aria-expanded")).toBe("true");

    leftToggle?.click();
    rightToggle?.click();
    (dockedTitle as HTMLButtonElement | null)?.click();
    expect(onToggleLeft).toHaveBeenCalledOnce();
    expect(onToggleOutline).toHaveBeenCalledOnce();
    expect(onTitleClick).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(
        <EditorTopbar
          leftVisible={false}
          outlineVisible={false}
          onToggleLeft={onToggleLeft}
          onToggleOutline={onToggleOutline}
        />,
      );
    });

    expect(container.querySelector("[aria-label='Show left sidebar']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Show right sidebar']")).not.toBeNull();
    expect(container.querySelector(".topbar-note-title")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".topbar-note-title")?.getAttribute("tabindex")).toBe("-1");

    await act(async () => root.unmount());
  });
});
