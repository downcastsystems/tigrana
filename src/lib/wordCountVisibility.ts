export const wordCountVisibilityKey = "tigrana-word-count-visible";

export function readStoredWordCountVisibility(storage: Pick<Storage, "getItem"> = localStorage) {
  return storage.getItem(wordCountVisibilityKey) !== "false";
}

export function writeStoredWordCountVisibility(
  visible: boolean,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  storage.setItem(wordCountVisibilityKey, String(visible));
}
