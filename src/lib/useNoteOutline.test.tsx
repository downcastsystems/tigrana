// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

const { useNoteOutline } = await import("./useNoteOutline");

function OutlineProbe({ body, documentKey, enabled = true }: { body: string; documentKey: string; enabled?: boolean }) {
  const outline = useNoteOutline("Draft", body, documentKey, enabled);
  return <output>{outline.map((entry) => entry.text).join("|")}</output>;
}

describe("useNoteOutline", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.useRealTimers();
  });

  function render(props: { body: string; documentKey: string; enabled?: boolean }) {
    if (!container) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    act(() => root?.render(<OutlineProbe {...props} />));
  }

  it("updates edits after an idle delay instead of during the typing render", () => {
    vi.useFakeTimers();
    render({ body: "## Opening", documentKey: "Draft.md" });
    expect(container?.textContent).toBe("Draft|Opening");

    render({ body: "## Revised", documentKey: "Draft.md" });
    expect(container?.textContent).toBe("Draft|Opening");

    act(() => vi.advanceTimersByTime(120));
    expect(container?.textContent).toBe("Draft|Revised");
  });

  it("updates immediately when switching documents", () => {
    vi.useFakeTimers();
    render({ body: "## First", documentKey: "First.md" });
    render({ body: "## Second", documentKey: "Second.md" });

    expect(container?.textContent).toBe("Draft|Second");
  });

  it("does no outline work while disabled and catches up when enabled", () => {
    vi.useFakeTimers();
    render({ body: "## Hidden", documentKey: "Draft.md", enabled: false });
    expect(container?.textContent).toBe("");

    render({ body: "## Current", documentKey: "Draft.md", enabled: false });
    act(() => vi.runAllTimers());
    expect(container?.textContent).toBe("");

    render({ body: "## Current", documentKey: "Draft.md", enabled: true });
    expect(container?.textContent).toBe("Draft|Current");
  });
});
