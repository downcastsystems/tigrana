import { describe, expect, it } from "vitest";
import {
  APP_ZOOM_STORAGE_KEY,
  DEFAULT_APP_ZOOM,
  readStoredAppZoom,
  resolveAppZoomCommand,
  writeStoredAppZoom,
} from "./appZoom";

describe("app zoom", () => {
  it("steps through readable zoom levels and clamps at the limits", () => {
    expect(resolveAppZoomCommand(1, "in")).toBe(1.1);
    expect(resolveAppZoomCommand(1, "out")).toBe(0.9);
    expect(resolveAppZoomCommand(1.2, "in")).toBe(1.25);
    expect(resolveAppZoomCommand(1.2, "out")).toBe(1.1);
    expect(resolveAppZoomCommand(3, "in")).toBe(3);
    expect(resolveAppZoomCommand(0.25, "out")).toBe(0.25);
  });

  it("resets to actual size", () => {
    expect(resolveAppZoomCommand(1.75, "reset")).toBe(DEFAULT_APP_ZOOM);
  });

  it("persists valid zoom and ignores invalid stored values", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writeStoredAppZoom(1.25, storage);
    expect(values.get(APP_ZOOM_STORAGE_KEY)).toBe("1.25");
    expect(readStoredAppZoom(storage)).toBe(1.25);

    values.set(APP_ZOOM_STORAGE_KEY, "not-a-number");
    expect(readStoredAppZoom(storage)).toBe(DEFAULT_APP_ZOOM);
    values.set(APP_ZOOM_STORAGE_KEY, "8");
    expect(readStoredAppZoom(storage)).toBe(DEFAULT_APP_ZOOM);
  });
});
