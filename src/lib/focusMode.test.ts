import { describe, expect, it } from "vitest";
import { toggleFocusMode, type PaneVisibility } from "./focusMode";

describe("focus mode", () => {
  it.each([
    { leftVisible: true, outlineVisible: true },
    { leftVisible: true, outlineVisible: false },
    { leftVisible: false, outlineVisible: true },
  ] satisfies PaneVisibility[])("restores the pane layout it collapsed: %o", (panes) => {
    const focused = toggleFocusMode(panes, null);

    expect(focused).toEqual({
      panes: { leftVisible: false, outlineVisible: false },
      restore: panes,
    });
    expect(toggleFocusMode(focused.panes, focused.restore)).toEqual({
      panes,
      restore: null,
    });
  });

  it("restores both panes when they were already collapsed without a saved layout", () => {
    expect(toggleFocusMode({ leftVisible: false, outlineVisible: false }, null)).toEqual({
      panes: { leftVisible: true, outlineVisible: true },
      restore: null,
    });
  });
});
