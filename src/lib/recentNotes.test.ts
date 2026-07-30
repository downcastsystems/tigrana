import { describe, expect, it } from "vitest";
import { defaultWorkspaceMetadata } from "./notebookStorage";
import { buildRecentNoteViews } from "./recentNotes";
import type { NoteEntry } from "../types";

const now = 2_000_000_000_000;

function note(path: string, title: string): NoteEntry {
  return { path, title, parent_path: "" };
}

describe("buildRecentNoteViews", () => {
  it("returns at most ten viewed notes, newest first", () => {
    const notes = Array.from({ length: 12 }, (_, index) => note(`Note ${index}.md`, `Note ${index}`));
    const metadata = defaultWorkspaceMetadata();
    metadata.notePositions = Object.fromEntries(
      notes.map((entry, index) => [
        entry.path,
        {
          path: entry.path,
          lastOpenedAt: now - index * 1_000,
          scrollTop: 0,
          contentLength: 0,
        },
      ]),
    );
    metadata.noteIcons["Note 0.md"] = "lucide:Star";

    expect(buildRecentNoteViews(notes, metadata)).toEqual([
      { path: "Note 0.md", title: "Note 0", icon: "lucide:Star", viewedAt: now },
      { path: "Note 1.md", title: "Note 1", icon: undefined, viewedAt: now - 1_000 },
      { path: "Note 2.md", title: "Note 2", icon: undefined, viewedAt: now - 2_000 },
      { path: "Note 3.md", title: "Note 3", icon: undefined, viewedAt: now - 3_000 },
      { path: "Note 4.md", title: "Note 4", icon: undefined, viewedAt: now - 4_000 },
      { path: "Note 5.md", title: "Note 5", icon: undefined, viewedAt: now - 5_000 },
      { path: "Note 6.md", title: "Note 6", icon: undefined, viewedAt: now - 6_000 },
      { path: "Note 7.md", title: "Note 7", icon: undefined, viewedAt: now - 7_000 },
      { path: "Note 8.md", title: "Note 8", icon: undefined, viewedAt: now - 8_000 },
      { path: "Note 9.md", title: "Note 9", icon: undefined, viewedAt: now - 9_000 },
    ]);
  });

  it("keeps older history while excluding never-viewed and deleted notes", () => {
    const notes = [note("Current.md", "Current"), note("Older.md", "Older"), note("Never.md", "Never")];
    const metadata = defaultWorkspaceMetadata();
    metadata.notePositions = {
      "Current.md": {
        path: "Current.md",
        lastOpenedAt: now - 1_000,
        scrollTop: 0,
        contentLength: 0,
      },
      "Older.md": {
        path: "Older.md",
        lastOpenedAt: 1,
        scrollTop: 0,
        contentLength: 0,
      },
      "Deleted.md": {
        path: "Deleted.md",
        lastOpenedAt: now - 1_000,
        scrollTop: 0,
        contentLength: 0,
      },
    };

    expect(buildRecentNoteViews(notes, metadata).map((entry) => entry.path)).toEqual(["Current.md", "Older.md"]);
  });
});
