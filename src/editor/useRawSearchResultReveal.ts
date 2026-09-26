import { useEffect, type RefObject } from "react";
import { findSearchPassage } from "../lib/search";
import { scheduleSearchReveal, type SearchRevealRequest } from "./searchResultReveal";

export function useRawSearchResultReveal(inputRef: RefObject<HTMLTextAreaElement>, enabled: boolean,
  request: SearchRevealRequest | null, workspace: string, notePath: string | null) {
  useEffect(() => {
    const input = inputRef.current;
    if (!enabled || !input || !request || request.workspace !== workspace || request.notePath !== notePath) return;
    let highlighted = false;
    const clear = () => {
      if (highlighted) input.setSelectionRange(input.selectionStart, input.selectionStart);
      highlighted = false;
    };
    return scheduleSearchReveal(input.closest<HTMLElement>(".note-surface") ?? input, () => {
      const match = findSearchPassage(input.value, request.query);
      if (!match) return;
      // Measure wrapped source text using the textarea's typography and width.
      const mirror = document.createElement("div");
      const style = getComputedStyle(input);
      for (const property of ["font", "line-height", "letter-spacing", "padding", "border", "box-sizing", "tab-size", "word-break", "overflow-wrap"]) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
      }
      Object.assign(mirror.style, { position: "fixed", visibility: "hidden", whiteSpace: "pre-wrap", width: `${input.clientWidth}px` });
      mirror.textContent = input.value.slice(0, match.start);
      const marker = document.createElement("span");
      marker.textContent = input.value.slice(match.start, match.end);
      mirror.append(marker);
      document.body.append(mirror);
      const top = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
      mirror.remove();
      input.focus({ preventScroll: true });
      input.setSelectionRange(match.start, match.end);
      input.scrollTop = Math.max(0, top - input.clientHeight * 0.42);
      highlighted = true;
    }, clear);
  }, [enabled, inputRef, notePath, request, workspace]);
}
