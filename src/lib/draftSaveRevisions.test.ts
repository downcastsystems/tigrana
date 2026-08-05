import { describe, expect, it } from "vitest";
import { DraftSaveRevisions } from "./draftSaveRevisions";

describe("DraftSaveRevisions", () => {
  it("requests a follow-up when a completed save is older than the current draft", () => {
    const revisions = new DraftSaveRevisions();
    revisions.reset("saved");
    const first = revisions.observe("first draft");
    revisions.markRequested(first);
    revisions.observe("second draft");

    expect(revisions.complete(first)).toBe(true);
  });

  it("does not duplicate a newer save that has already been requested", () => {
    const revisions = new DraftSaveRevisions();
    revisions.reset("saved");
    const first = revisions.observe("first draft");
    revisions.markRequested(first);
    const second = revisions.observe("second draft");
    revisions.markRequested(second);

    expect(revisions.complete(first)).toBe(false);
    expect(revisions.complete(second)).toBe(false);
  });

  it("ignores completions from a previously loaded Note", () => {
    const revisions = new DraftSaveRevisions();
    revisions.reset("first Note");
    const firstNoteSave = revisions.observe("edited first Note");
    revisions.markRequested(firstNoteSave);
    revisions.reset("second Note");

    expect(revisions.complete(firstNoteSave)).toBe(false);
  });
});
