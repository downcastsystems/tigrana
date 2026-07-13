import { describe, expect, it } from "vitest";
import { shouldApplyEditorUpdate } from "./noteEditorUpdates";

describe("shouldApplyEditorUpdate", () => {
  it("rejects an update from the previously loaded note after a switch", () => {
    expect(shouldApplyEditorUpdate("Note B.md", "Note A.md", true)).toBe(false);
  });

  it("accepts an editable update from the active note", () => {
    expect(shouldApplyEditorUpdate("Note B.md", "Note B.md", true)).toBe(true);
  });

  it("rejects updates while the note is read-only or no document is loaded", () => {
    expect(shouldApplyEditorUpdate("Note B.md", "Note B.md", false)).toBe(false);
    expect(shouldApplyEditorUpdate("Note B.md", null, true)).toBe(false);
  });
});
