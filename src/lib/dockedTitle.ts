type VerticalBounds = {
  top: number;
  bottom: number;
};

const titleVisibilityTolerance = 1;

export function shouldDockNoteTitle(titleBounds: VerticalBounds, viewportBounds: VerticalBounds): boolean {
  return titleBounds.bottom <= viewportBounds.top + titleVisibilityTolerance;
}
