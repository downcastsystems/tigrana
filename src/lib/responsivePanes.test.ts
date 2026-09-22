import { describe, expect, it } from "vitest";
import { resolveResponsivePanes, type PaneLayout } from "./responsivePanes";

const layout: PaneLayout = { width: 1600, navigationStyle: "section-view", folderWidth: 292,
  notesWidth: 268, rightWidth: 300, gap: 6, leftVisible: true, outlineVisible: true };

describe("editor-first pane layout", () => {
  it.each(["section-view", "dual-pane"] as const)("hides the right pane before the left panes in %s", navigationStyle => {
    const options = { ...layout, navigationStyle };
    expect(resolveResponsivePanes({ ...options, width: 1398 })).toEqual({ leftVisible: true, outlineVisible: true });
    expect(resolveResponsivePanes({ ...options, width: 1397 })).toEqual({ leftVisible: true, outlineVisible: false });
    expect(resolveResponsivePanes({ ...options, width: 1092 })).toEqual({ leftVisible: true, outlineVisible: false });
    expect(resolveResponsivePanes({ ...options, width: 1091 })).toEqual({ leftVisible: false, outlineVisible: false });
  });
  it("keeps single-pane navigation until it would crowd the editor", () => {
    expect(resolveResponsivePanes({ ...layout, navigationStyle: "single-pane", width: 900 })).toEqual({ leftVisible: true, outlineVisible: false });
    expect(resolveResponsivePanes({ ...layout, navigationStyle: "single-pane", width: 793 })).toEqual({ leftVisible: false, outlineVisible: false });
  });
  it("accounts for resized panes and theme gutters", () => {
    expect(resolveResponsivePanes({ ...layout, width: 1400, rightWidth: 460, gap: 20 })).toEqual({ leftVisible: true, outlineVisible: false });
    expect(resolveResponsivePanes({ ...layout, width: 1400, folderWidth: 420, notesWidth: 520, gap: 20 })).toEqual({ leftVisible: false, outlineVisible: false });
  });
  it("respects manual visibility and restores it when space returns", () => {
    const chosen = { ...layout, leftVisible: false };
    expect(resolveResponsivePanes({ ...chosen, width: 800 })).toEqual({ leftVisible: false, outlineVisible: false });
    expect(resolveResponsivePanes(chosen)).toEqual({ leftVisible: false, outlineVisible: true });
    expect(resolveResponsivePanes({ ...layout, outlineVisible: false })).toEqual({ leftVisible: true, outlineVisible: false });
    expect(resolveResponsivePanes({ ...layout, leftVisible: false, outlineVisible: false })).toEqual({ leftVisible: false, outlineVisible: false });
  });
});
