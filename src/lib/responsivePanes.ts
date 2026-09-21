import type { NavigationStyle } from "../types";
import type { PaneVisibility } from "./focusMode";

// Includes the note's horizontal padding, leaving about 448px for writing.
export const minimumEditorPaneWidth = 520;

export type PaneLayout = PaneVisibility & {
  width: number;
  navigationStyle: NavigationStyle;
  folderWidth: number;
  notesWidth: number;
  rightWidth: number;
  gap: number;
};

export function resolveResponsivePanes(layout: PaneLayout): PaneVisibility {
  const { width, navigationStyle, folderWidth, notesWidth, rightWidth, gap } = layout;
  let { leftVisible, outlineVisible } = layout;
  const leftWidth = navigationStyle === "single-pane" ? notesWidth : folderWidth + gap + notesWidth;
  const editorWidth = () => width - (leftVisible ? leftWidth + gap : 0) - (outlineVisible ? rightWidth + gap : 0);
  if (editorWidth() < minimumEditorPaneWidth) outlineVisible = false;
  if (editorWidth() < minimumEditorPaneWidth) leftVisible = false;
  return { leftVisible, outlineVisible };
}
