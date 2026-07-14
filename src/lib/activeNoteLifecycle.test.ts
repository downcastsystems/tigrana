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

  it("asks an overlapping path change to retry without running stale work", async () => {
    const { subject } = lifecycle();
    const first = deferred();
    const order: string[] = [];
    const firstChange = subject.runPathChange("First.md", "First.md", async () => {
      order.push("first:start");
      await first.promise;
      order.push("first:end");
    });
    const secondChange = subject.runPathChange("Second.md", "Second.md", async () => {
      order.push("second");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    first.resolve();
    await expect(firstChange).resolves.toBe("completed");
    await expect(secondChange).resolves.toBe("retry");
    expect(order).toEqual(["first:start", "first:end"]);

    await expect(subject.runPathChange("Second.md", "Second.md", async () => {
      order.push("second:fresh");
    })).resolves.toBe("completed");
    expect(order).toEqual(["first:start", "first:end", "second:fresh"]);
  });

  it("reports and rejects a failed path change", async () => {
    const { errors, subject } = lifecycle();
    const failure = new Error("rename failed");

    await expect(subject.runPathChange("Note.md", "Note.md", async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(errors).toEqual([failure]);
    expect(subject.hasPathChange).toBe(false);
  });

  it("coalesces overlapping persistence requests onto the latest work", async () => {
    const { subject } = lifecycle();
    const first = deferred();
    const order: string[] = [];
    const firstRequest = subject.requestPersistence(async () => {
      order.push("first:start");
      await first.promise;
      order.push("first:end");
      return "first";
    });
    const secondRequest = subject.requestPersistence(async () => {
      order.push("second");
      return "second";
    });
    const thirdRequest = subject.requestPersistence(async () => {
      order.push("third");
      return "third";
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    first.resolve();
    await expect(Promise.all([firstRequest, secondRequest, thirdRequest]))
      .resolves.toEqual(["third", "third", "third"]);
    expect(order).toEqual(["first:start", "first:end", "third"]);
  });

  it("recovers after a failed persistence request", async () => {
    const { subject } = lifecycle();
    const failure = new Error("save failed");

    await expect(subject.requestPersistence(async () => {
      throw failure;
    })).rejects.toBe(failure);
    await expect(subject.requestPersistence(async () => "saved")).resolves.toBe("saved");
  });

  it("runs a newer persistence request after the active attempt fails", async () => {
    const { subject } = lifecycle();
    const first = deferred();
    const failure = new Error("first save failed");
    const order: string[] = [];
    const firstRequest = subject.requestPersistence(async () => {
      order.push("first:start");
      await first.promise;
      throw failure;
    });
    const secondRequest = subject.requestPersistence(async () => {
      order.push("second");
      return "saved latest";
    });

    first.resolve();
    await expect(Promise.all([firstRequest, secondRequest]))
      .resolves.toEqual(["saved latest", "saved latest"]);
    expect(order).toEqual(["first:start", "second"]);
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
