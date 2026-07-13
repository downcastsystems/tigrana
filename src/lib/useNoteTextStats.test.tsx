// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNoteTextStats, type NoteTextStatsWorker } from "./useNoteTextStats";
import type { NoteTextStatsResponse } from "./noteTextStats";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeWorker implements NoteTextStatsWorker {
  onmessage: ((event: MessageEvent<NoteTextStatsResponse>) => void) | null = null;
  messages: Array<{ requestId: number; text: string }> = [];
  terminated = false;

  postMessage(message: { requestId: number; text: string }) {
    this.messages.push(message);
  }

  respond(response: NoteTextStatsResponse) {
    this.onmessage?.({ data: response } as MessageEvent<NoteTextStatsResponse>);
  }

  terminate() {
    this.terminated = true;
  }
}

function StatsHarness({
  createWorker,
  onStats,
  text,
}: {
  createWorker: () => NoteTextStatsWorker;
  onStats: (stats: { words: number; characters: number }) => void;
  text: string;
}) {
  const stats = useNoteTextStats(text, "Draft.md", 80, createWorker);
  useEffect(() => onStats(stats), [onStats, stats]);
  return null;
}

describe("background Note text statistics", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("debounces edits, computes off-thread, and ignores stale results", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const createWorker = vi.fn(() => worker);
    const onStats = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<StatsHarness createWorker={createWorker} onStats={onStats} text="First" />);
    });
    await act(async () => {
      vi.advanceTimersByTime(40);
    });
    await act(async () => {
      root.render(<StatsHarness createWorker={createWorker} onStats={onStats} text="Second draft" />);
    });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });

    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0].text).toBe("Second draft");

    await act(async () => {
      root.render(<StatsHarness createWorker={createWorker} onStats={onStats} text="Final draft" />);
    });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    expect(worker.messages[1].text).toBe("Final draft");

    await act(async () => {
      worker.respond({ requestId: worker.messages[0].requestId, stats: { words: 2, characters: 12 } });
      worker.respond({ requestId: worker.messages[1].requestId, stats: { words: 2, characters: 11 } });
    });
    expect(onStats).toHaveBeenLastCalledWith({ words: 2, characters: 11 });

    await act(async () => root.unmount());
    expect(worker.terminated).toBe(true);
  });
});
