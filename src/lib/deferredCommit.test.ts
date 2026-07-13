import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferredCommit } from "./deferredCommit";

describe("createDeferredCommit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits only the latest scheduled value after the idle delay", () => {
    vi.useFakeTimers();
    const committed: string[] = [];
    const deferred = createDeferredCommit<string>(80, (value) => committed.push(value));

    deferred.schedule(() => "first");
    deferred.schedule(() => "latest");

    expect(committed).toEqual([]);
    vi.advanceTimersByTime(79);
    expect(committed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(committed).toEqual(["latest"]);
    expect(deferred.hasPending()).toBe(false);
  });

  it("flushes synchronously and cancels the idle commit", () => {
    vi.useFakeTimers();
    const committed: string[] = [];
    const deferred = createDeferredCommit<string>(80, (value) => committed.push(value));

    deferred.schedule(() => "final keystroke");

    expect(deferred.flush()).toBe("final keystroke");
    expect(committed).toEqual(["final keystroke"]);
    vi.runAllTimers();
    expect(committed).toEqual(["final keystroke"]);
  });

  it("cancels pending work without committing it", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const deferred = createDeferredCommit(80, commit);

    deferred.schedule(() => "discarded");
    deferred.cancel();
    vi.runAllTimers();

    expect(commit).not.toHaveBeenCalled();
    expect(deferred.flush()).toBeNull();
  });
});
