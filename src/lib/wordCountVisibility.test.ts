import { describe, expect, it, vi } from "vitest";
import {
  readStoredWordCountVisibility,
  wordCountVisibilityKey,
  writeStoredWordCountVisibility,
} from "./wordCountVisibility";

describe("word count visibility", () => {
  it("is visible by default", () => {
    const storage = { getItem: vi.fn(() => null) };

    expect(readStoredWordCountVisibility(storage)).toBe(true);
    expect(storage.getItem).toHaveBeenCalledWith(wordCountVisibilityKey);
  });

  it("restores an explicitly hidden word count", () => {
    const storage = { getItem: vi.fn(() => "false") };

    expect(readStoredWordCountVisibility(storage)).toBe(false);
  });

  it("persists the current visibility", () => {
    const storage = { setItem: vi.fn() };

    writeStoredWordCountVisibility(false, storage);

    expect(storage.setItem).toHaveBeenCalledWith(wordCountVisibilityKey, "false");
  });
});
