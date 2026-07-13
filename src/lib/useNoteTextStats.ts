import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  measureNoteText,
  type NoteTextStats,
  type NoteTextStatsRequest,
  type NoteTextStatsResponse,
} from "./noteTextStats";

export type NoteTextStatsWorker = {
  onmessage: ((event: MessageEvent<NoteTextStatsResponse>) => void) | null;
  postMessage(message: NoteTextStatsRequest): void;
  terminate(): void;
};

type WorkerFactory = () => NoteTextStatsWorker | null;

const createBrowserWorker: WorkerFactory = () => (
  typeof Worker === "undefined"
    ? null
    : new Worker(new URL("../workers/noteTextStats.worker.ts", import.meta.url), { type: "module" })
);

export function useNoteTextStats(
  text: string,
  documentKey: string | null,
  delay = 80,
  createWorker: WorkerFactory = createBrowserWorker,
) {
  const [stats, setStats] = useState<NoteTextStats>({ words: 0, characters: 0 });
  const workerRef = useRef<NoteTextStatsWorker | null>(null);
  const requestIdRef = useRef(0);
  const activeRequestIdRef = useRef(0);
  const textRef = useRef(text);
  textRef.current = text;

  useLayoutEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    activeRequestIdRef.current = requestId;
    setStats(measureNoteText(textRef.current));
  }, [documentKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      activeRequestIdRef.current = requestId;
      const worker = workerRef.current ?? createWorker();
      workerRef.current = worker;

      if (!worker) {
        setStats(measureNoteText(text));
        return;
      }

      worker.onmessage = (event) => {
        if (event.data.requestId !== activeRequestIdRef.current) return;
        setStats(event.data.stats);
      };
      worker.postMessage({ requestId, text });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [createWorker, delay, text]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  return stats;
}
