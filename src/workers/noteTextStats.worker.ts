/// <reference lib="webworker" />

import { measureNoteText, type NoteTextStatsRequest, type NoteTextStatsResponse } from "../lib/noteTextStats";

self.onmessage = (event: MessageEvent<NoteTextStatsRequest>) => {
  const response: NoteTextStatsResponse = {
    requestId: event.data.requestId,
    stats: measureNoteText(event.data.text),
  };
  self.postMessage(response);
};
