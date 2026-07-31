// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookmarkView } from "./lib/notebookMetadata";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { BookmarksSection } = await import("./App");

function pointerEvent(type: string, clientX: number, clientY: number) {
  return new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX, clientY });
}

describe("Bookmarks section", () => {
  const containers: HTMLElement[] = [];

  afterEach(() => {
    containers.splice(0).forEach((container) => container.remove());
  });

  it("marks and reorders a bookmark through the pointer drag path", async () => {
    const bookmarks: BookmarkView[] = [
      { id: "alpha", kind: "note", path: "Alpha.md", createdAt: 1, title: "Alpha", missing: false },
      { id: "bravo", kind: "folder", path: "Bravo", createdAt: 2, title: "Bravo", missing: false },
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    const onReorder = vi.fn();

    await act(async () => {
      root.render(
        <BookmarksSection
          bookmarks={bookmarks}
          expanded
          onRemove={vi.fn()}
          onReorder={onReorder}
          onSelect={vi.fn()}
          onToggle={vi.fn()}
        />,
      );
    });

    const alpha = container.querySelector<HTMLButtonElement>('[data-bookmark-id="alpha"]');
    const bravo = container.querySelector<HTMLButtonElement>('[data-bookmark-id="bravo"]');
    expect(alpha).not.toBeNull();
    expect(bravo).not.toBeNull();
    alpha!.getBoundingClientRect = () => ({
      bottom: 30,
      height: 30,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => alpha),
    });

    await act(async () => {
      bravo?.dispatchEvent(pointerEvent("pointerdown", 100, 50));
      window.dispatchEvent(pointerEvent("pointermove", 100, 5));
    });
    expect(alpha?.classList.contains("is-reorder-before")).toBe(true);

    await act(async () => {
      window.dispatchEvent(pointerEvent("pointerup", 100, 5));
    });
    expect(onReorder).toHaveBeenCalledWith("bravo", "alpha", "before");
    expect(alpha?.classList.contains("is-reorder-before")).toBe(false);

    await act(async () => root.unmount());
  });
});
