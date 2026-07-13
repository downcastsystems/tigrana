export type DeferredCommit<T> = {
  cancel(): void;
  flush(): T | null;
  hasPending(): boolean;
  schedule(readLatest: () => T): void;
};

export function createDeferredCommit<T>(delayMs: number, commit: (value: T) => void): DeferredCommit<T> {
  let pending: (() => T) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    const readLatest = pending;
    if (!readLatest) return null;
    pending = null;
    clearTimer();
    const value = readLatest();
    commit(value);
    return value;
  };

  return {
    schedule(readLatest) {
      pending = readLatest;
      clearTimer();
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      pending = null;
      clearTimer();
    },
    hasPending() {
      return pending !== null;
    },
  };
}
