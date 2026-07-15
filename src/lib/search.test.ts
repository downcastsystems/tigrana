import { describe, expect, it } from "vitest";
import { recentNotes, searchNotes } from "./search";
import type { NoteEntry } from "../types";

const notes: NoteEntry[] = [
  { path: "Projects/Alpha.md", title: "Alpha plan", parent_path: "Projects", updated_at: 1_700_000_000 },
  { path: "Projects/Archive/Beta.md", title: "Beta notes", parent_path: "Projects/Archive", updated_at: 1_600_000_000 },
  { path: "Journal/Today.md", title: "Today", parent_path: "Journal", updated_at: 1_710_000_000 },
];

const contents = new Map([
  ["Projects/Alpha.md", "---\nid: abc\n---\n\nThe launch checklist mentions cobalt."],
  ["Projects/Archive/Beta.md", "A quiet archived cobalt reference."],
  ["Journal/Today.md", "Alpha appeared in the body only."],
]);

describe("notebook search", () => {
  it("searches note titles and bodies while excluding frontmatter", () => {
    expect(searchNotes(notes, contents, "cobalt").map((note) => note.path)).toEqual([
      "Projects/Alpha.md",
      "Projects/Archive/Beta.md",
    ]);
    expect(searchNotes(notes, contents, "frontmatter-secret-7f5c")).toEqual([]);
  });

  it("supports title-only and nested folder filters", () => {
    expect(searchNotes(notes, contents, "alpha", { titleOnly: true }).map((note) => note.path)).toEqual([
      "Projects/Alpha.md",
    ]);
    expect(searchNotes(notes, contents, "cobalt", { folderPath: "Projects" })).toHaveLength(2);
    expect(searchNotes(notes, contents, "cobalt", { folderPath: "Projects/Archive" }).map((note) => note.path)).toEqual([
      "Projects/Archive/Beta.md",
    ]);
  });

  it("filters and sorts by modified date", () => {
    const now = 1_711_000_000_000;
    expect(searchNotes(notes, contents, "alpha", { dateRange: "month", now }).map((note) => note.path)).toEqual([
      "Journal/Today.md",
    ]);
    expect(searchNotes(notes, contents, "cobalt", { sort: "edited-asc" }).map((note) => note.path)).toEqual([
      "Projects/Archive/Beta.md",
      "Projects/Alpha.md",
    ]);
  });

  it("shows recently viewed notes first and falls back to recently edited notes", () => {
    const recent = recentNotes(notes, contents, {
      "Projects/Alpha.md": { path: "Projects/Alpha.md", lastOpenedAt: 10, scrollTop: 0, contentLength: 1 },
      "Journal/Today.md": { path: "Journal/Today.md", lastOpenedAt: 20, scrollTop: 0, contentLength: 1 },
    });
    expect(recent.fallback).toBe(false);
    expect(recent.results.map((note) => note.path)).toEqual(["Journal/Today.md", "Projects/Alpha.md"]);
    expect(recentNotes(notes, contents, {
      "Projects/Alpha.md": { path: "Projects/Alpha.md", lastOpenedAt: 10, scrollTop: 0, contentLength: 1 },
      "Journal/Today.md": { path: "Journal/Today.md", lastOpenedAt: 20, scrollTop: 0, contentLength: 1 },
    }, { sort: "title" }).results.map((note) => note.title)).toEqual(["Alpha plan", "Today"]);

    const fallback = recentNotes(notes, contents, {});
    expect(fallback.fallback).toBe(true);
    expect(fallback.results[0].path).toBe("Journal/Today.md");
  });
});
