import { describe, expect, it, vi } from "vitest";
import {
  ActiveNoteLifecycle,
  getMissingNoteChangeAction,
  getWatchedContentChangeAction,
} from "./activeNoteLifecycle";
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

  it("keeps only the latest Note navigation intent current", () => {
    const { subject } = lifecycle();
    const first = subject.beginNavigation("First.md");
    const second = subject.beginNavigation("Second.md");

    expect(subject.isCurrentNavigation(first)).toBe(false);
    expect(subject.isCurrentNavigation(second)).toBe(true);
    expect(subject.captureNavigation()).toBe(second);

    subject.cancelNavigation();
    expect(subject.isCurrentNavigation(second)).toBe(false);
  });

  it("preserves newer navigation away from a target being deleted", () => {
    const { subject } = lifecycle();
    const deletion = subject.beginNavigation();
    subject.beginNavigation("Second.md");

    expect(subject.deletedTargetDisposition(
      deletion,
      "First.md",
      (path) => path === "First.md",
    )).toBe("clearAndPreserveNavigation");
  });

  it("cancels newer navigation onto a target being deleted", () => {
    const { subject } = lifecycle();
    subject.beginNavigation("Deleted.md");

    expect(subject.deletedTargetDisposition(
      null,
      "Current.md",
      (path) => path === "Deleted.md",
    )).toBe("clearAndCancelNavigation");
  });

  it("clears the active target when its deletion intent is still current", () => {
    const { subject } = lifecycle();
    const deletion = subject.beginNavigation();

    expect(subject.deletedTargetDisposition(
      deletion,
      "Deleted.md",
      () => false,
    )).toBe("clearAndCancelNavigation");
  });

  it("ignores deletion after newer navigation has already opened another Note", () => {
    const { subject } = lifecycle();
    const deletion = subject.beginNavigation();
    subject.beginNavigation("Second.md");

    expect(subject.deletedTargetDisposition(
      deletion,
      "Second.md",
      (path) => path === "First.md",
    )).toBe("ignore");
  });

  it("fully clears a deleted active Note when no navigation remains in flight", () => {
    const { subject } = lifecycle();
    const navigation = subject.beginNavigation("Deleted.md");
    subject.settleNavigation(navigation);

    expect(subject.deletedTargetDisposition(
      null,
      "Deleted.md",
      (path) => path === "Deleted.md",
    )).toBe("clearAndCancelNavigation");
  });

  it("does not retain a loaded path as a stale deletion target after a move", () => {
    const { subject } = lifecycle();
    const navigation = subject.beginNavigation("Folder/Note.md");
    subject.settleNavigation(navigation);

    expect(subject.deletedTargetDisposition(
      null,
      "Other/Note.md",
      (path) => path === "Folder" || path.startsWith("Folder/"),
    )).toBe("ignore");
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

  it("defers a missing-path watcher event while an internal rename is in flight", async () => {
    const { subject } = lifecycle();
    const rename = deferred();
    const mutation = subject.runPathMutation("Old title.md", false, async () => {
      await rename.promise;
    });

    expect(subject.isPathMutationInFlight("Old title.md")).toBe(true);
    expect(subject.isPathMutationInFlight("Unrelated.md")).toBe(false);
    expect(getMissingNoteChangeAction({
      activePath: "Old title.md",
      changedPath: "Old title.md",
      hasPathMutation: subject.isPathMutationInFlight("Old title.md"),
      hasUnsavedChanges: true,
    })).toBe("defer");

    rename.resolve();
    await mutation;
    expect(subject.isPathMutationInFlight("Old title.md")).toBe(false);
  });

  it("scopes folder path mutations to their descendants", async () => {
    const { subject } = lifecycle();
    const rename = deferred();
    const mutation = subject.runPathMutation("Projects", true, async () => {
      await rename.promise;
    });

    expect(subject.isPathMutationInFlight("Projects/Plan.md")).toBe(true);
    expect(subject.isPathMutationInFlight("Project Archive/Plan.md")).toBe(false);

    rename.resolve();
    await mutation;
  });

  it("preserves an active unsaved Note when its watched path is missing", () => {
    expect(getMissingNoteChangeAction({
      activePath: "Note.md",
      changedPath: "Note.md",
      hasPathMutation: false,
      hasUnsavedChanges: true,
    })).toBe("preserve");
    expect(getMissingNoteChangeAction({
      activePath: "Other.md",
      changedPath: "Note.md",
      hasPathMutation: false,
      hasUnsavedChanges: false,
    })).toBe("refresh");
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

  it("defers a same-identity watcher mismatch throughout an internal title path change", () => {
    expect(getWatchedContentChangeAction({
      diskChange: "externalChange",
      hasPathChange: true,
      activeNoteIdentity: "note-123",
      changedNoteIdentity: "note-123",
      hasUnsavedChanges: true,
    })).toBe("defer");
  });

  it("still warns for genuine external edits with unsaved work", () => {
    expect(getWatchedContentChangeAction({
      diskChange: "externalChange",
      hasPathChange: false,
      activeNoteIdentity: "note-123",
      changedNoteIdentity: "note-123",
      hasUnsavedChanges: true,
    })).toBe("warn");
    expect(getWatchedContentChangeAction({
      diskChange: "externalChange",
      hasPathChange: true,
      activeNoteIdentity: "note-123",
      changedNoteIdentity: "other-note",
      hasUnsavedChanges: true,
    })).toBe("warn");
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

  it("does not let an older lock request replace a newer Note lock", async () => {
    let resolveFirst!: (result: { acquired: boolean }) => void;
    const firstResult = new Promise<{ acquired: boolean }>((resolve) => { resolveFirst = resolve; });
    const acquireNoteEditLock = vi.fn()
      .mockImplementationOnce(() => firstResult)
      .mockResolvedValueOnce({ acquired: true });
    const { storage, subject } = lifecycle({ acquireNoteEditLock });

    const first = subject.acquireLock("First.md");
    while (acquireNoteEditLock.mock.calls.length === 0) await Promise.resolve();
    const second = subject.acquireLock("Second.md");
    resolveFirst({ acquired: true });

    await expect(first).resolves.toBe("readOnlyLocked");
    await expect(second).resolves.toBe("editable");
    expect(subject.activeLockRef.current?.path).toBe("Second.md");
    expect(storage.releaseNoteEditLock).toHaveBeenCalledWith("/Notebook", "First.md", "main");
  });

  it("releases a stale same-Note acquisition before reacquiring it", async () => {
    let resolveFirst!: (result: { acquired: boolean }) => void;
    const firstResult = new Promise<{ acquired: boolean }>((resolve) => { resolveFirst = resolve; });
    const acquireNoteEditLock = vi.fn()
      .mockImplementationOnce(() => firstResult)
      .mockResolvedValueOnce({ acquired: true });
    const { storage, subject } = lifecycle({ acquireNoteEditLock });

    const first = subject.acquireLock("Note.md");
    while (acquireNoteEditLock.mock.calls.length === 0) await Promise.resolve();
    const second = subject.acquireLock("Note.md");
    resolveFirst({ acquired: true });

    await expect(first).resolves.toBe("readOnlyLocked");
    await expect(second).resolves.toBe("editable");
    expect(subject.activeLockRef.current?.path).toBe("Note.md");
    expect(storage.releaseNoteEditLock).toHaveBeenCalledWith("/Notebook", "Note.md", "main");
  });

  it("releases a lock request invalidated by newer Note navigation", async () => {
    let resolveAcquire!: (result: { acquired: boolean }) => void;
    const result = new Promise<{ acquired: boolean }>((resolve) => { resolveAcquire = resolve; });
    const acquireNoteEditLock = vi.fn(() => result);
    const { storage, subject } = lifecycle({ acquireNoteEditLock });

    const acquisition = subject.acquireLock("First.md");
    while (acquireNoteEditLock.mock.calls.length === 0) await Promise.resolve();
    subject.beginNavigation();
    resolveAcquire({ acquired: true });

    await expect(acquisition).resolves.toBe("readOnlyLocked");
    expect(subject.activeLockRef.current).toBeNull();
    expect(storage.releaseNoteEditLock).toHaveBeenCalledWith("/Notebook", "First.md", "main");
  });

  it("finishes a requested release before reacquiring the same Note", async () => {
    const release = deferred();
    const events: string[] = [];
    const acquireNoteEditLock = vi.fn(async () => {
      events.push("acquire");
      return { acquired: true };
    });
    const releaseNoteEditLock = vi.fn(async () => {
      events.push("release:start");
      await release.promise;
      events.push("release:end");
    });
    const { subject } = lifecycle({ acquireNoteEditLock, releaseNoteEditLock });

    await expect(subject.acquireLock("Note.md")).resolves.toBe("editable");
    const requestedRelease = subject.releaseLock();
    const reacquisition = subject.acquireLock("Note.md");
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["acquire", "release:start"]);

    release.resolve();
    await requestedRelease;
    await expect(reacquisition).resolves.toBe("editable");
    expect(events).toEqual(["acquire", "release:start", "release:end", "acquire"]);
  });

  it("releases only a deleted-path lock without cancelling newer navigation", async () => {
    const { storage, subject } = lifecycle();
    await expect(subject.acquireLock("Deleted.md")).resolves.toBe("editable");
    const newerNavigation = subject.beginNavigation("Next.md");

    await subject.releaseLockMatching("/Notebook", (path) => path === "Deleted.md");

    expect(subject.activeLockRef.current).toBeNull();
    expect(subject.isCurrentNavigation(newerNavigation)).toBe(true);
    expect(storage.releaseNoteEditLock).toHaveBeenCalledWith("/Notebook", "Deleted.md", "main");
  });
});
