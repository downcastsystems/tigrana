// @vitest-environment jsdom

import { Component, type ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppCrashBoundary from "./AppCrashBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class BrokenApp extends Component {
  render(): ReactNode {
    throw new Error("Context menu position loop");
  }
}

describe("AppCrashBoundary", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("replaces a blank render with an actionable error screen", async () => {
    const onReload = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AppCrashBoundary onReload={onReload}>
          <BrokenApp />
        </AppCrashBoundary>,
      );
    });

    expect(container.querySelector<HTMLElement>("[role=alert]")?.textContent)
      .toContain("Tigrana ran into an error");
    expect(container.querySelector("pre")?.textContent)
      .toContain("Context menu position loop");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(onReload).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });
});
