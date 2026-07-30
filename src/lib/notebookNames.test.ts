import { describe, expect, it } from "vitest";
import { decodeTitleFromFilename, encodeTitleForFilename, validateNoteTitle } from "./notebookNames";

describe("Notebook file names", () => {
  it("round-trips portable title characters that conflict with paths or URL encoding", () => {
    const title = ".Draft / Act #1 at 50%";
    expect(decodeTitleFromFilename(encodeTitleForFilename(title))).toBe(title);
  });

  it("reserves the fullwidth solidus as the portable filename token for slash", () => {
    expect(encodeTitleForFilename("Draft/Final")).toBe("Draft／Final");
    expect(decodeTitleFromFilename("Draft／Final")).toBe("Draft/Final");
  });

  it("rejects empty, reserved, invalid, and control-character titles", () => {
    for (const title of ["", "..", "bad:name", "line\nbreak"]) {
      expect(() => validateNoteTitle(title)).toThrow();
    }
  });
});
