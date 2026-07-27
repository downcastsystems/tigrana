import { normalizeNoteMarkdown } from "./noteDocument";
import type { NotebookStorage } from "./notebookStorage";

export type ActiveNoteAccess = "editable" | "readOnlyLocked";

export type ActiveNoteLock = {
  workspace: string;
  path: string;
  windowLabel: string;
};

export type DiskChangeKind = "acceptedWrite" | "matchesEditor" | "externalChange";
export type DeletedTargetDisposition = "clearAndCancelNavigation" | "clearAndPreserveNavigation" | "ignore";
export type MissingNoteChangeAction = "defer" | "preserve" | "refresh";
export type WatchedContentChangeAction = "accept" | "defer" | "warn" | "reload";

export function getMissingNoteChangeAction({
  activePath,
  changedPath,
  hasPathMutation,
  hasUnsavedChanges,
}: {
  activePath: string | null;
  changedPath: string;
  hasPathMutation: boolean;
  hasUnsavedChanges: boolean;
}): MissingNoteChangeAction {
  if (activePath !== changedPath) return "refresh";
  if (hasPathMutation) return "defer";
  if (hasUnsavedChanges) return "preserve";
  return "refresh";
}

export function getWatchedContentChangeAction({
  diskChange,
  hasPathChange,
  activeNoteIdentity,
  changedNoteIdentity,
  hasUnsavedChanges,
}: {
  diskChange: DiskChangeKind;
  hasPathChange: boolean;
  activeNoteIdentity: string | null;
  changedNoteIdentity: string | null;
  hasUnsavedChanges: boolean;
}): WatchedContentChangeAction {
  if (diskChange !== "externalChange") return "accept";
  if (
    hasPathChange
    && activeNoteIdentity
    && changedNoteIdentity
    && activeNoteIdentity === changedNoteIdentity
  ) {
    return "defer";
  }
  if (hasUnsavedChanges) return "warn";
  return "reload";
}

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
  private lockGeneration = 0;
  private loadGeneration = 0;
  private navigationGeneration = 0;
  private navigationTarget: string | null = null;
  private lockOperationTail: Promise<void> = Promise.resolve();
  private activeLoadToken = 0;
  private saveQueues = new Map<string, Promise<void>>();
  private savingPathCounts = new Map<string, number>();
  private pathMutationScopes: Array<{ path: string; includesDescendants: boolean }> = [];
  private pathChangeTail: Promise<void> | null = null;
  private persistenceRun: Promise<string | undefined> | null = null;
  private latestPersistenceWork: (() => Promise<string | undefined>) | null = null;
  private persistenceRequestedAgain = false;

  constructor(private readonly options: ActiveNoteLifecycleOptions) {}

  resetWorkspace() {
    this.lockGeneration += 1;
    this.navigationGeneration += 1;
    this.navigationTarget = null;
    this.acceptedDiskContent.clear();
    this.pathMutationScopes = [];
    this.cancelLoads();
  }

  beginNavigation(target: string | null = null) {
    this.lockGeneration += 1;
    this.navigationGeneration += 1;
    this.navigationTarget = target;
    return this.navigationGeneration;
  }

  setNavigationTarget(token: number, target: string) {
    if (!this.isCurrentNavigation(token)) return false;
    this.navigationTarget = target;
    return true;
  }

  settleNavigation(token: number) {
    if (!this.isCurrentNavigation(token)) return;
    this.navigationTarget = null;
  }

  captureNavigation() {
    return this.navigationGeneration;
  }

  isCurrentNavigation(token: number) {
    return this.navigationGeneration === token;
  }

  deletedTargetDisposition(
    token: number | null,
    activePath: string | null,
    matchesDeletedPath: (path: string) => boolean,
  ): DeletedTargetDisposition {
    if (
      (token !== null && this.isCurrentNavigation(token))
      || (this.navigationTarget !== null && matchesDeletedPath(this.navigationTarget))
    ) {
      return "clearAndCancelNavigation";
    }
    if (activePath !== null && matchesDeletedPath(activePath)) {
      return this.navigationTarget === null
        ? "clearAndCancelNavigation"
        : "clearAndPreserveNavigation";
    }
    return "ignore";
  }

  cancelNavigation() {
    this.lockGeneration += 1;
    this.navigationGeneration += 1;
    this.navigationTarget = null;
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
    const generation = ++this.lockGeneration;
    return this.enqueueLockOperation(async () => {
      if (generation !== this.lockGeneration || this.options.getWorkspace() !== workspace) {
        return "readOnlyLocked";
      }
      const current = this.activeLockRef.current;
      if (current?.workspace === workspace && current.path === path && current.windowLabel === windowLabel) {
        return "editable";
      }

      await this.releaseCurrentLock();
      if (generation !== this.lockGeneration || this.options.getWorkspace() !== workspace) {
        return "readOnlyLocked";
      }
      const result = await this.options.storage.acquireNoteEditLock(workspace, path, windowLabel);
      if (generation !== this.lockGeneration || this.options.getWorkspace() !== workspace) {
        if (result.acquired) {
          try {
            await this.options.storage.releaseNoteEditLock(workspace, path, windowLabel);
          } catch (error) {
            console.warn("release_note_edit_lock failed", error);
          }
        }
        return "readOnlyLocked";
      }
      if (!result.acquired) {
        this.activeLockRef.current = null;
        return "readOnlyLocked";
      }
      this.activeLockRef.current = { workspace, path, windowLabel };
      return "editable";
    });
  }

  async releaseLock() {
    this.lockGeneration += 1;
    await this.enqueueLockOperation(() => this.releaseCurrentLock());
  }

  async releaseLockMatching(workspace: string, matchesPath: (path: string) => boolean) {
    await this.enqueueLockOperation(async () => {
      const lock = this.activeLockRef.current;
      if (!lock || lock.workspace !== workspace || !matchesPath(lock.path)) return;
      await this.releaseCurrentLock();
    });
  }

  private async releaseCurrentLock() {
    const lock = this.activeLockRef.current;
    if (!lock) return;
    this.activeLockRef.current = null;
    try {
      await this.options.storage.releaseNoteEditLock(lock.workspace, lock.path, lock.windowLabel);
    } catch (error) {
      console.warn("release_note_edit_lock failed", error);
    }
  }

  private enqueueLockOperation<T>(operation: () => Promise<T>) {
    const result = this.lockOperationTail
      .catch(() => undefined)
      .then(operation);
    this.lockOperationTail = result.then(() => undefined, () => undefined);
    return result;
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

  async runPathMutation<T>(
    path: string,
    includesDescendants: boolean,
    work: () => Promise<T>,
  ) {
    const scope = { path, includesDescendants };
    this.pathMutationScopes.push(scope);
    try {
      return await work();
    } finally {
      const index = this.pathMutationScopes.indexOf(scope);
      if (index !== -1) this.pathMutationScopes.splice(index, 1);
    }
  }

  isPathMutationInFlight(path: string) {
    return this.pathMutationScopes.some((scope) =>
      path === scope.path
      || (scope.includesDescendants && path.startsWith(`${scope.path}/`)),
    );
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
