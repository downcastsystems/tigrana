import { startTransition, useEffect, useLayoutEffect, useRef, useState } from "react";
import { extractNoteOutline, type NoteOutlineEntry } from "./noteDocument";

const outlineIdleDelayMs = 120;

type OutlineSource = {
  body: string;
  documentKey: string;
  title: string;
};

function sameSource(left: OutlineSource | null, right: OutlineSource) {
  return left?.documentKey === right.documentKey && left.title === right.title && left.body === right.body;
}

export function useNoteOutline(
  title: string,
  body: string,
  documentKey: string | null,
  enabled: boolean,
): NoteOutlineEntry[] {
  const [outline, setOutline] = useState<NoteOutlineEntry[]>([]);
  const lastComputedSourceRef = useRef<OutlineSource | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !documentKey) {
      lastComputedSourceRef.current = null;
      setOutline((current) => (current.length ? [] : current));
      return;
    }

    const source = { body, documentKey, title };
    if (lastComputedSourceRef.current?.documentKey === documentKey) return;
    lastComputedSourceRef.current = source;
    setOutline(extractNoteOutline(title, body));
  }, [body, documentKey, enabled, title]);

  useEffect(() => {
    if (!enabled || !documentKey) return;
    const source = { body, documentKey, title };
    if (sameSource(lastComputedSourceRef.current, source)) return;

    const timer = window.setTimeout(() => {
      const nextOutline = extractNoteOutline(title, body);
      lastComputedSourceRef.current = source;
      startTransition(() => setOutline(nextOutline));
    }, outlineIdleDelayMs);
    return () => window.clearTimeout(timer);
  }, [body, documentKey, enabled, title]);

  return outline;
}
