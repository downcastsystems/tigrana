import { describe, expect, it, vi } from "vitest";
import { ActiveNoteLifecycle } from "./activeNoteLifecycle";
import type { NotebookStorage } from "./notebookStorage";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function lifecycle(storageOverrides: Partial<NotebookStorage> = {}) {
  const errors: unknown[] = [];
  const saving: Set<string>[] = [];
  const storage = {
    acquireNoteEditLock: vi.fn(async () => ({ acquired: true })),
    releaseNoteEditLock: vi.fn(async () => {}),
    ...storageOverrides,
  } as NotebookStorage;
  return {
    errors,
    saving,
    storage,
    subject: new ActiveNoteLifecycle({
      storage,
      getWorkspace: () => "/Notebook",
      getWindowLabel: () => "main",
      onError: (error) => { errors.push(error); },
      onSavingPathsChange: (paths) => { saving.push(paths); },
    }),
  };
}

describe("active Note lifecycle", () => {
  it("invalidates stale loads", () => {
    const { subject } = lifecycle();
    const first = subject.beginLoad();
    const second = subject.beginLoad();
    expect(subject.isCurrentLoad(first)).toBe(false);
    expect(subject.isCurrentLoad(second)).toBe(true);
    subject.finishLoad(second);
    expect(subject.isLoading).toBe(false);
  });

  it("serializes overlapping saves for the same Note", async () => {
    const { subject } = lifecycle();
    const first = deferred();
    const order: string[] = [];
    const firstSave = subject.enqueueSave("Note.md", async () => {
      order.push("first:start");
      await first.promise;
      order.push("first:end");
    });
    const secondSave = subject.enqueueSave("Note.md", async () => { order.push("second"); });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    first.resolve();
    await Promise.all([firstSave, secondSave]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("waits for a queued body save before a rename path change", async () => {
    const { subject } = lifecycle();
    const body = deferred();
    const order: string[] = [];
    const save = subject.enqueueSave("Old.md", async () => {
      order.push("save:start");
      await body.promise;
      order.push("save:end");
    });
    const rename = subject.runPathChange("Old.md", "Old.md", async () => { order.push("rename"); });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["save:start"]);
    body.resolve();
    await Promise.all([save, rename]);
    expect(order).toEqual(["save:start", "save:end", "rename"]);
  });

  it("distinguishes watcher echoes, editor matches, and external changes", () => {
    const { subject } = lifecycle();
    subject.acceptDiskContent("Note.md", "saved\n");
    expect(subject.observeDiskContent("Note.md", "saved")).toBe("acceptedWrite");
    expect(subject.observeDiskContent("Note.md", "draft", "draft\n")).toBe("matchesEditor");
    expect(subject.observeDiskContent("Note.md", "someone else's edit", "draft")).toBe("externalChange");
  });

  it("reports lock denial and releases an acquired lock", async () => {
    const denied = lifecycle({ acquireNoteEditLock: vi.fn(async () => ({ acquired: false })) });
    await expect(denied.subject.acquireLock("Note.md")).resolves.toBe("readOnlyLocked");
    expect(denied.subject.activeLockRef.current).toBeNull();

    const acquired = lifecycle();
    await expect(acquired.subject.acquireLock("Note.md")).resolves.toBe("editable");
    await acquired.subject.releaseLock();
    expect(acquired.storage.releaseNoteEditLock).toHaveBeenCalledWith("/Notebook", "Note.md", "main");
  });
});
