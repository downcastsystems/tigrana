import { describe, expect, it } from "vitest";
import { shouldDockNoteTitle } from "./dockedTitle";

describe("docked note title", () => {
  const viewport = { top: 58, bottom: 658 };

  it("stays in the note toolbar while any of the title block remains visible", () => {
    expect(shouldDockNoteTitle({ top: 20, bottom: 80 }, viewport)).toBe(false);
  });

  it("docks once the complete title block has left the note viewport", () => {
    expect(shouldDockNoteTitle({ top: -20, bottom: 58 }, viewport)).toBe(true);
  });
});
