import { describe, expect, it } from "vitest";
import { recentNotes, searchNotes, noteSearchPreview, findSearchMatch } from "./search";
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

it("searches across color boundaries and keeps color markup out of results", () => {
  const colored = new Map([[notes[0].path, 'The launch <span style="color: #a83232">checklist</span> is ready.']]);
  const result = searchNotes([notes[0]], colored, "launch checklist");
  expect(result).toHaveLength(1);
  expect(result[0].snippet).toBe("The launch checklist is ready.");
  expect(noteSearchPreview(colored.get(notes[0].path)!)).toBe("The launch checklist is ready.");
  expect(recentNotes([notes[0]], colored, {}).results[0].snippet).toBe("The launch checklist is ready.");
});

it("finds page 777 only in the long note, with its matching passage", () => {
  const entries = [100, 1000].map(pages => ({ path: `${pages}.md`, title: `${pages} pages`, parent_path: "" }));
  const bodies = new Map(entries.map((entry, i) => [entry.path,
    Array.from({ length: i ? 1000 : 100 }, (_, page) => `## Page ${page + 1}\n\n${'Some ordinary prose. '.repeat(50)}`).join('\n\n')]));
  const results = searchNotes(entries, bodies, "page 777");
  expect(results.map(note => note.path)).toEqual(["1000.md"]);
  expect(results[0].snippet).toContain("Page 777");
});

it("ranks an exact body phrase ahead of a recent fuzzy title regardless of note length", () => {
  const entries = [
    { path: "Fuzzy.md", title: "Launch checklis", parent_path: "", updated_at: Date.now() / 1000 },
    { path: "Exact.md", title: "Archive", parent_path: "", updated_at: 1 },
  ];
  const bodies = new Map([["Exact.md", `${'ordinary prose '.repeat(50000)}launch checklist`]]);
  expect(searchNotes(entries, bodies, "launch checklist").map(note => note.path)).toEqual(["Exact.md", "Fuzzy.md"]);
});

it("supports numeric prefixes without shortening or approximating the query", () => {
  const entries = ["Page 77", "Page 777", "Page 7777", "Launch checklist", "Launch checklis"].map(title => ({ title, path: `${title}.md`, parent_path: "" }));
  expect(searchNotes(entries, new Map(), "page 777").map(note => note.title)).toEqual(["Page 777", "Page 7777"]);
  expect(searchNotes(entries, new Map(), '"launch checklist"').map(note => note.title)).toEqual(["Launch checklist"]);
  expect(searchNotes(entries, new Map(), "page 777", { titleOnly: true })).toHaveLength(2);
  expect(searchNotes(entries, new Map(), "page 77").map(note => note.title)).toEqual(["Page 77", "Page 777", "Page 7777"]);
  expect(searchNotes(entries, new Map(), '"page 77"').map(note => note.title)).toEqual(["Page 77"]);
});

it("keeps typo tolerance for words and shows the matching passage", () => {
  const bodies = new Map([[notes[0].path, `${'Unrelated introduction. '.repeat(100)}\n\nReview the launch checklist before release.`]]);
  const results = searchNotes([notes[0]], bodies, "launch cheklist");
  expect(results).toHaveLength(1);
  expect(results[0].snippet).toContain("launch checklist");
});

it("keeps exact title matches first and honors explicit sorting", () => {
  const entries = [
    { path: "Body.md", title: "Body", parent_path: "", updated_at: 20 },
    { path: "Title.md", title: "Cobalt", parent_path: "", updated_at: 10 },
  ];
  const bodies = new Map([["Body.md", "Cobalt"]]);
  expect(searchNotes(entries, bodies, "cobalt").map(note => note.path)).toEqual(["Title.md", "Body.md"]);
  expect(searchNotes(entries, bodies, "cobalt", { sort: "edited-desc" }).map(note => note.path)).toEqual(["Body.md", "Title.md"]);
});

it("normalizes phrase whitespace, escapes punctuation, and excludes managed fields", () => {
  const entries = [{ path: "Notes.md", title: "Notes", parent_path: "" }];
  const bodies = new Map([["Notes.md", '---\nid: 777\n---\n\nA [draft] of the launch\nchecklist. Page 7777 is here.\n\nPage 777 is later.']]);
  expect(searchNotes(entries, bodies, '"launch   checklist"')).toHaveLength(1);
  expect(searchNotes(entries, bodies, '"[draft]"')).toHaveLength(1);
  expect(searchNotes(entries, bodies, '"id: 777"')).toEqual([]);
  expect(searchNotes(entries, bodies, "page 777")[0].snippet).toContain("Page 777 is later");
  expect(searchNotes(entries, bodies, '""')).toEqual([]);
});

it("ranks exact body numbers above title prefixes and previews a distant prefix match", () => {
  const entries = [
    { path: "Prefix.md", title: "Page 777", parent_path: "", updated_at: Date.now() / 1000 },
    { path: "Exact.md", title: "Reference", parent_path: "", updated_at: 1 },
    { path: "Body.md", title: "Other", parent_path: "" },
  ];
  const bodies = new Map([["Exact.md", "Page 77"], ["Body.md", `${'Opening. '.repeat(100)}Page 777 is here.`]]);
  const results = searchNotes(entries, bodies, "page 77");
  expect(results.map(note => note.path)).toEqual(["Exact.md", "Prefix.md", "Body.md"]);
  expect(results[2].snippet).toContain("Page 777 is here");
  expect(findSearchMatch("Page 777", "page 77")).toEqual({ start: 0, end: 7 });
  expect(findSearchMatch("Page 77", "page 777")).toBeNull();
  expect(findSearchMatch("Page 177", "77")).toBeNull();
  expect(findSearchMatch("Page 777", '"page 77"')).toBeNull();
});
