import { normalizeNoteMarkdown } from "./noteDocument";
import type { NotebookStorage } from "./notebookStorage";

export type ActiveNoteAccess = "editable" | "readOnlyLocked";

export type ActiveNoteLock = {
  workspace: string;
  path: string;
  windowLabel: string;
};

export type DiskChangeKind = "acceptedWrite" | "matchesEditor" | "externalChange";

type ActiveNoteLifecycleOptions = {
  storage: Pick<NotebookStorage, "acquireNoteEditLock" | "releaseNoteEditLock">;
  getWorkspace: () => string | null;
  getWindowLabel: () => string;
  onError: (error: unknown) => void;
  onSavingPathsChange?: (paths: Set<string>) => void;
};

export class ActiveNoteLifecycle {
  readonly activeLockRef: { current: ActiveNoteLock | null } = { current: null };

  private acceptedDiskContent = new Map<string, string>();
  private loadGeneration = 0;
  private activeLoadToken = 0;
  private saveQueues = new Map<string, Promise<void>>();
  private savingPathCounts = new Map<string, number>();
  private pathChangeTail: Promise<void> | null = null;
  private persistenceRun: Promise<string | undefined> | null = null;
  private latestPersistenceWork: (() => Promise<string | undefined>) | null = null;
  private persistenceRequestedAgain = false;

  constructor(private readonly options: ActiveNoteLifecycleOptions) {}

  resetWorkspace() {
    this.acceptedDiskContent.clear();
    this.cancelLoads();
  }

  beginLoad() {
    const token = this.loadGeneration + 1;
    this.loadGeneration = token;
    this.activeLoadToken = token;
    return token;
  }

  isCurrentLoad(token: number) {
    return this.loadGeneration === token;
  }

  finishLoad(token: number) {
    if (this.activeLoadToken === token) this.activeLoadToken = 0;
  }

  cancelLoads() {
    this.loadGeneration += 1;
    this.activeLoadToken = 0;
  }

  get isLoading() {
    return this.activeLoadToken !== 0;
  }

  acceptDiskContent(path: string, content: string) {
    this.acceptedDiskContent.set(path, normalizeNoteMarkdown(content));
  }

  forgetDiskContent(path: string) {
    this.acceptedDiskContent.delete(path);
  }

  observeDiskContent(path: string, content: string, editorContent?: string): DiskChangeKind {
    const normalized = normalizeNoteMarkdown(content);
    if (this.acceptedDiskContent.get(path) === normalized) return "acceptedWrite";
    if (editorContent !== undefined && normalizeNoteMarkdown(editorContent) === normalized) {
      this.acceptedDiskContent.set(path, normalized);
      return "matchesEditor";
    }
    return "externalChange";
  }

  async acquireLock(path: string): Promise<ActiveNoteAccess> {
    const workspace = this.options.getWorkspace();
    if (!workspace) {
      this.activeLockRef.current = null;
      return "editable";
    }
    const windowLabel = this.options.getWindowLabel();
    const current = this.activeLockRef.current;
    if (current?.workspace === workspace && current.path === path && current.windowLabel === windowLabel) {
      return "editable";
    }

    await this.releaseLock();
    const result = await this.options.storage.acquireNoteEditLock(workspace, path, windowLabel);
    if (!result.acquired) {
      this.activeLockRef.current = null;
      return "readOnlyLocked";
    }
    this.activeLockRef.current = { workspace, path, windowLabel };
    return "editable";
  }

  async releaseLock() {
    const lock = this.activeLockRef.current;
    if (!lock) return;
    this.activeLockRef.current = null;
    try {
      await this.options.storage.releaseNoteEditLock(lock.workspace, lock.path, lock.windowLabel);
    } catch (error) {
      console.warn("release_note_edit_lock failed", error);
    }
  }

  enqueueSave(path: string, work: () => Promise<void>) {
    const previousSave = this.saveQueues.get(path);
    const previous = previousSave ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(work)
      .catch(this.options.onError)
      .finally(() => {
        if (this.saveQueues.get(path) !== next) return;
        this.saveQueues.delete(path);
        this.setSaving(path, false);
      });
    this.saveQueues.set(path, next);
    if (!previousSave) this.setSaving(path, true);
    return next;
  }

  requestPersistence(work: () => Promise<string | undefined>) {
    this.latestPersistenceWork = work;
    if (this.persistenceRun) {
      this.persistenceRequestedAgain = true;
      return this.persistenceRun;
    }

    const run = this.drainPersistenceRequests();
    const tracked = run.finally(() => {
      if (this.persistenceRun !== tracked) return;
      this.persistenceRun = null;
      this.latestPersistenceWork = null;
      this.persistenceRequestedAgain = false;
    });
    this.persistenceRun = tracked;
    return tracked;
  }

  async runPathChange(savingKey: string, currentPath: string | null, work: () => Promise<void>) {
    const activePathChange = this.pathChangeTail;
    if (activePathChange) {
      await activePathChange;
      return "retry" as const;
    }

    const operation = (async () => {
      if (currentPath) await this.waitForPathSaves(currentPath);
      await work();
    })();
    this.setSaving(savingKey, true);
    const tracked = operation.catch((error) => {
      this.options.onError(error);
      throw error;
    }).finally(() => {
      this.setSaving(savingKey, false);
      if (this.pathChangeTail === tracked) this.pathChangeTail = null;
    });
    this.pathChangeTail = tracked;
    await tracked;
    return "completed" as const;
  }

  get hasPathChange() {
    return this.pathChangeTail !== null;
  }

  async waitForPendingSaves() {
    while (this.saveQueues.size > 0) {
      await Promise.allSettled(Array.from(this.saveQueues.values()));
    }
  }

  async flushPendingSaves() {
    while (this.persistenceRun) await this.persistenceRun;
    while (this.pathChangeTail) await this.pathChangeTail;
    await this.waitForPendingSaves();
  }

  private async drainPersistenceRequests() {
    let result: string | undefined;
    do {
      this.persistenceRequestedAgain = false;
      const work = this.latestPersistenceWork;
      if (!work) return result;
      try {
        result = await work();
      } catch (error) {
        if (!this.persistenceRequestedAgain) throw error;
      }
    } while (this.persistenceRequestedAgain);
    return result;
  }

  private async waitForPathSaves(path: string) {
    while (this.saveQueues.has(path)) {
      await Promise.allSettled([this.saveQueues.get(path)!]);
    }
  }

  private setSaving(path: string, saving: boolean) {
    const nextCount = (this.savingPathCounts.get(path) ?? 0) + (saving ? 1 : -1);
    if (nextCount > 0) this.savingPathCounts.set(path, nextCount);
    else this.savingPathCounts.delete(path);
    this.options.onSavingPathsChange?.(new Set(this.savingPathCounts.keys()));
  }
}
