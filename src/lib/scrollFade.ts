export type ScrollFadeVisibility = {
  top: boolean;
  bottom: boolean;
};

type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

const scrollBoundaryTolerance = 1;

export function getScrollFadeVisibility({
  scrollTop,
  scrollHeight,
  clientHeight,
}: ScrollMetrics): ScrollFadeVisibility {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (maxScrollTop <= scrollBoundaryTolerance) return { top: false, bottom: false };

  return {
    top: scrollTop > scrollBoundaryTolerance,
    bottom: scrollTop < maxScrollTop - scrollBoundaryTolerance,
  };
}
