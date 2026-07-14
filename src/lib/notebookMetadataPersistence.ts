import type { WorkspaceMetadata } from "../types";
import { mergeWorkspaceMetadataChanges } from "./notebookMetadata";
import type { NotebookStorage } from "./notebookStorage";

type MetadataWriter = Pick<NotebookStorage, "writeWorkspaceMetadata">;
type MetadataAcceptor = (workspace: string, metadata: WorkspaceMetadata) => void;
export type MetadataUpdater = (current: WorkspaceMetadata) => WorkspaceMetadata;

type MutationOptions = {
  defer?: boolean;
  coalesceKey?: string;
};

type MutationWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

type PendingMutation = {
  id: number;
  updater: MetadataUpdater;
  coalesceKey?: string;
  waiters: MutationWaiter[];
};

type WorkspaceQueue = {
  acceptMetadata: MetadataAcceptor;
  autoDrain: boolean;
  drainPromise: Promise<void> | null;
  inFlightIds: Set<number>;
  nextId: number;
  pending: PendingMutation[];
  localMetadata: WorkspaceMetadata;
};

export class NotebookMetadataPersistence {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly queues = new Map<string, WorkspaceQueue>();

  constructor(private readonly storage: MetadataWriter) {}

  mutate(
    workspace: string,
    updater: MetadataUpdater,
    localMetadata: WorkspaceMetadata,
    acceptMetadata: MetadataAcceptor = () => {},
    options: MutationOptions = {},
  ) {
    const queue = this.getQueue(workspace, localMetadata, acceptMetadata);
    queue.localMetadata = localMetadata;
    queue.acceptMetadata = acceptMetadata;

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const mutation: PendingMutation = {
      id: ++queue.nextId,
      updater,
      coalesceKey: options.coalesceKey,
      waiters: [{ resolve, reject }],
    };

    if (options.coalesceKey) {
      let replaceIndex = -1;
      for (let index = queue.pending.length - 1; index >= 0; index -= 1) {
        const pending = queue.pending[index];
        if (pending.coalesceKey === options.coalesceKey && !queue.inFlightIds.has(pending.id)) {
          replaceIndex = index;
          break;
        }
      }
      if (replaceIndex !== -1) {
        queue.pending[replaceIndex].waiters.forEach((waiter) => waiter.resolve());
        queue.pending.splice(replaceIndex, 1);
      }
    }
    queue.pending.push(mutation);

    if (!options.defer) {
      queue.autoDrain = true;
      this.ensureDrain(workspace, queue);
    }
    return completion;
  }

  rebasePending(
    workspace: string,
    forward: MetadataUpdater,
    reverse: MetadataUpdater,
    localMetadata: WorkspaceMetadata,
  ) {
    const queue = this.queues.get(workspace);
    if (!queue) return;
    queue.localMetadata = localMetadata;
    queue.pending = queue.pending.map((pending) => ({
      ...pending,
      updater: (current) => {
        const reverseBase = reverse(current);
        const reverseUpdated = pending.updater(reverseBase);
        return mergeWorkspaceMetadataChanges(
          forward(reverseBase),
          forward(reverseUpdated),
          current,
        );
      },
    }));
  }

  runExclusive<T>(workspace: string, operation: () => Promise<T>) {
    return this.enqueue(workspace, operation);
  }

  flush(workspace: string) {
    const queue = this.queues.get(workspace);
    if (!queue?.pending.length) return this.tails.get(workspace) ?? Promise.resolve();

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    queue.pending.at(-1)!.waiters.push({ resolve, reject });
    queue.autoDrain = true;
    this.ensureDrain(workspace, queue);
    return completion;
  }

  private getQueue(
    workspace: string,
    localMetadata: WorkspaceMetadata,
    acceptMetadata: MetadataAcceptor,
  ) {
    const existing = this.queues.get(workspace);
    if (existing) return existing;
    const queue: WorkspaceQueue = {
      acceptMetadata,
      autoDrain: false,
      drainPromise: null,
      inFlightIds: new Set(),
      nextId: 0,
      pending: [],
      localMetadata,
    };
    this.queues.set(workspace, queue);
    return queue;
  }

  private ensureDrain(workspace: string, queue: WorkspaceQueue) {
    if (queue.drainPromise || queue.pending.length === 0) return;
    queue.autoDrain = false;
    const drain = this.enqueue(workspace, () => this.drainBatch(workspace, queue));
    queue.drainPromise = drain;
    void drain.then(
      () => this.finishDrain(workspace, queue, drain),
      () => this.finishDrain(workspace, queue, drain),
    );
  }

  private finishDrain(workspace: string, queue: WorkspaceQueue, drain: Promise<void>) {
    if (queue.drainPromise !== drain) return;
    queue.drainPromise = null;
    if (queue.pending.length > 0 && queue.autoDrain) this.ensureDrain(workspace, queue);
  }

  private async drainBatch(workspace: string, queue: WorkspaceQueue) {
    const attempted = [...queue.pending];
    const attemptedIds = new Set(attempted.map((mutation) => mutation.id));
    attemptedIds.forEach((id) => queue.inFlightIds.add(id));
    let requested = attempted.reduce(
      (current, mutation) => mutation.updater(current),
      queue.localMetadata,
    );

    try {
      for (;;) {
        const result = await this.storage.writeWorkspaceMetadata(workspace, requested);
        if (!result.applied) {
          requested = attempted.reduce(
            (current, mutation) => mutation.updater(current),
            result.metadata,
          );
          const optimistic = queue.pending
            .filter((mutation) => !attemptedIds.has(mutation.id))
            .reduce((current, mutation) => mutation.updater(current), requested);
          queue.localMetadata = optimistic;
          queue.acceptMetadata(workspace, optimistic);
          continue;
        }

        queue.pending = queue.pending.filter((mutation) => !attemptedIds.has(mutation.id));
        const optimistic = queue.pending.reduce(
          (current, mutation) => mutation.updater(current),
          result.metadata,
        );
        queue.localMetadata = optimistic;
        queue.acceptMetadata(workspace, optimistic);
        attempted.forEach((mutation) => mutation.waiters.forEach((waiter) => waiter.resolve()));
        return;
      }
    } catch (error) {
      attempted.forEach((mutation) => {
        mutation.waiters.forEach((waiter) => waiter.reject(error));
        mutation.waiters = [];
      });
      throw error;
    } finally {
      attemptedIds.forEach((id) => queue.inFlightIds.delete(id));
    }
  }

  private enqueue<T>(workspace: string, operation: () => Promise<T>) {
    const previous = this.tails.get(workspace) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(workspace, tail);
    void tail.then(() => {
      if (this.tails.get(workspace) === tail) this.tails.delete(workspace);
    });
    return result;
  }
}
