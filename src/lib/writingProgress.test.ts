import { expect, it } from "vitest";
import { defaultWorkspaceMetadata } from "./notebookStorage";
import { dailyWritingCounts, localWritingDay, setWritingGoal, writingProgressMutation } from "./writingProgress";
import { NotebookMetadataPersistence } from "./notebookMetadataPersistence";
const note = (text: string, id = "stable-note") => `---\nid: ${id}\n---\n${text}`;

it("counts net saved words by local day and UUID without counting existing words", () => {
  let metadata = defaultWorkspaceMetadata();
  const day = localWritingDay(new Date(2026, 8, 28, 0, 5));
  expect(day).toBe("2026-09-28");
  metadata = writingProgressMutation(note("Existing text"), note("Existing text with new words"), day, "Old.md")!(metadata);
  expect(dailyWritingCounts(metadata, day, "stable-note")).toEqual({ notebook: 3, note: 3 });
  metadata = writingProgressMutation(note("Existing text with new words"), note("Existing"), day, "Renamed.md")!(metadata);
  expect(dailyWritingCounts(metadata, day, "stable-note")).toEqual({ notebook: 0, note: 0 });
  metadata = writingProgressMutation(note("Existing"), note("Existing text"), day, "Renamed.md")!(metadata);
  expect(dailyWritingCounts(metadata, day, "stable-note").note).toBe(0);
  expect(dailyWritingCounts(metadata, "2026-09-29", "stable-note").notebook).toBe(0);
});
it("keeps independent portable notebook and note goals", () => {
  let metadata = setWritingGoal(defaultWorkspaceMetadata(), null, 500);
  metadata = setWritingGoal(metadata, "stable-note", 200);
  expect(metadata.writingProgress).toMatchObject({ notebookGoal: 500, noteGoals: { "stable-note": 200 } });
  expect(setWritingGoal(metadata, "stable-note", 0)).toBe(metadata);
  expect(setWritingGoal(metadata, "stable-note", 1.5)).toBe(metadata);
  expect(setWritingGoal(metadata, "stable-note", null).writingProgress?.noteGoals).toEqual({});
  expect(writingProgressMutation(note("same text"), note("**same** text"), "today", "x")).toBeNull();
});
it("replays progress deltas after a metadata revision conflict without overwriting other notes", async () => {
  let durable = defaultWorkspaceMetadata();
  const local = durable;
  durable = writingProgressMutation(note("", "other"), note("one two", "other"), "today", "other")!(durable);
  durable.revision = 1;
  const persistence = new NotebookMetadataPersistence({ writeWorkspaceMetadata: async (_workspace, metadata) => {
    if (metadata.revision !== durable.revision) return { applied: false, metadata: durable };
    durable = { ...metadata, revision: durable.revision + 1 };
    return { applied: true, metadata: durable };
  } });
  await persistence.mutate("Notebook", writingProgressMutation(note("old"), note("old new words"), "today", "x")!, local);
  expect(dailyWritingCounts(durable, "today", "stable-note")).toEqual({ notebook: 4, note: 2 });
});

it("does not count optimistic saves again when a queued batch is replayed", async () => {
  const base = defaultWorkspaceMetadata();
  const first = writingProgressMutation(note(""), note("one two"), "today", "x")!;
  const second = writingProgressMutation(note("one two"), note("one two three"), "today", "x")!;
  const optimistic = second(first(base));
  let durable = base;
  const persistence = new NotebookMetadataPersistence({ writeWorkspaceMetadata: async (_workspace, metadata) => {
    durable = { ...metadata, revision: metadata.revision + 1 };
    return { applied: true, metadata: durable };
  } });
  const writes = [persistence.mutate("Notebook", first, first(base)), persistence.mutate("Notebook", second, optimistic)];
  await Promise.all(writes);
  expect(dailyWritingCounts(durable, "today", "stable-note")).toEqual({ notebook: 3, note: 3 });
});
