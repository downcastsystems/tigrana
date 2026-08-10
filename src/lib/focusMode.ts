export type PaneVisibility = {
  leftVisible: boolean;
  outlineVisible: boolean;
};

export type FocusModeTransition = {
  panes: PaneVisibility;
  restore: PaneVisibility | null;
};

const defaultPaneVisibility: PaneVisibility = {
  leftVisible: true,
  outlineVisible: true,
};

export function toggleFocusMode(
  panes: PaneVisibility,
  restore: PaneVisibility | null,
): FocusModeTransition {
  const focused = !panes.leftVisible && !panes.outlineVisible;
  if (!focused) {
    return {
      panes: { leftVisible: false, outlineVisible: false },
      restore: panes,
    };
  }

  const restoredPanes = restore?.leftVisible || restore?.outlineVisible
    ? restore
    : defaultPaneVisibility;
  return {
    panes: restoredPanes,
    restore: null,
  };
}
