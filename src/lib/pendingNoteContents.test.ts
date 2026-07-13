import { describe, expect, it } from "vitest";
import { PendingNoteContents } from "./pendingNoteContents";

describe("PendingNoteContents", () => {
  it("returns a staged autosave draft ahead of the last React cache value", () => {
    const pending = new PendingNoteContents();

    pending.stage("Story.md", "latest draft");

    expect(pending.read("Story.md", "last rendered value")).toBe("latest draft");
  });

  it("does not let an older save completion discard a newer staged draft", () => {
    const pending = new PendingNoteContents();
    pending.stage("Story.md", "first autosave");
    pending.stage("Story.md", "newer typing");

    expect(pending.accept("Story.md", "first autosave")).toBe(false);
    expect(pending.read("Story.md", "disk value")).toBe("newer typing");
  });

  it("clears a staged draft only when that exact content reaches disk", () => {
    const pending = new PendingNoteContents();
    pending.stage("Story.md", "saved draft");

    expect(pending.accept("Story.md", "saved draft")).toBe(true);
    expect(pending.read("Story.md", "disk value")).toBe("disk value");
  });
});
