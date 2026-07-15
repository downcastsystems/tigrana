export const DEFAULT_APP_ZOOM = 1;
export const APP_ZOOM_STORAGE_KEY = "tigrana-app-zoom";

const APP_ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const MIN_APP_ZOOM = APP_ZOOM_LEVELS[0];
const MAX_APP_ZOOM = APP_ZOOM_LEVELS[APP_ZOOM_LEVELS.length - 1];
const ZOOM_EPSILON = 0.001;

export type AppZoomCommand = "in" | "out" | "reset";

type ZoomStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): ZoomStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function readStoredAppZoom(storage: ZoomStorage | null = defaultStorage()) {
  if (!storage) return DEFAULT_APP_ZOOM;
  try {
    const value = Number(storage.getItem(APP_ZOOM_STORAGE_KEY));
    return Number.isFinite(value) && value >= MIN_APP_ZOOM && value <= MAX_APP_ZOOM
      ? value
      : DEFAULT_APP_ZOOM;
  } catch {
    return DEFAULT_APP_ZOOM;
  }
}

export function writeStoredAppZoom(value: number, storage: ZoomStorage | null = defaultStorage()) {
  if (!storage) return;
  try {
    storage.setItem(APP_ZOOM_STORAGE_KEY, String(value));
  } catch {
    // App zoom is still useful for the current session if storage is unavailable.
  }
}

export function resolveAppZoomCommand(current: number, command: AppZoomCommand) {
  if (command === "reset") return DEFAULT_APP_ZOOM;

  if (command === "in") {
    return APP_ZOOM_LEVELS.find((level) => level > current + ZOOM_EPSILON) ?? MAX_APP_ZOOM;
  }

  return [...APP_ZOOM_LEVELS].reverse().find((level) => level < current - ZOOM_EPSILON) ?? MIN_APP_ZOOM;
}
