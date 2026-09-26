import { PhysicalPosition, PhysicalSize, type Monitor } from "@tauri-apps/api/window";

const windowSizeKey = "tigrana-window-size";

const windowPositionKey = "tigrana-window-position";

export function readStoredWindowSize(): { width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(windowSizeKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    return null;
  }
}

export function readStoredWindowPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(windowPositionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

export function writeStoredWindowSize(size: { width: number; height: number }) {
  try {
    localStorage.setItem(windowSizeKey, JSON.stringify(size));
  } catch {
    // localStorage may be unavailable (private mode quota); ignore.
  }
}

export function writeStoredWindowPosition(position: { x: number; y: number }) {
  try {
    localStorage.setItem(windowPositionKey, JSON.stringify(position));
  } catch {
    // localStorage may be unavailable (private mode quota); ignore.
  }
}

export function fitWindowToMonitors(
  position: { x: number; y: number },
  size: { width: number; height: number },
  monitors: Monitor[],
) {
  const target = monitors.reduce((nearest, monitor) => {
    return monitorDistance(position, monitor) < monitorDistance(position, nearest) ? monitor : nearest;
  });
  const { workArea } = target;
  const fittedSize = new PhysicalSize(
    Math.min(size.width, workArea.size.width),
    Math.min(size.height, workArea.size.height),
  );
  const maxX = workArea.position.x + Math.max(workArea.size.width - fittedSize.width, 0);
  const maxY = workArea.position.y + Math.max(workArea.size.height - fittedSize.height, 0);
  return {
    position: new PhysicalPosition(
      clamp(position.x, workArea.position.x, maxX),
      clamp(position.y, workArea.position.y, maxY),
    ),
    size: fittedSize,
  };
}

function monitorDistance(position: { x: number; y: number }, monitor: Monitor) {
  const { workArea } = monitor;
  const x = clamp(position.x, workArea.position.x, workArea.position.x + workArea.size.width);
  const y = clamp(position.y, workArea.position.y, workArea.position.y + workArea.size.height);
  return (position.x - x) ** 2 + (position.y - y) ** 2;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
