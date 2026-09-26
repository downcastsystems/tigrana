import { importWord } from "./importWord";
self.onmessage = event => {
  try { self.postMessage({ result: importWord(new Uint8Array(event.data)) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
