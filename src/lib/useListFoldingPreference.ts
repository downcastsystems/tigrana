import { useEffect, useState } from "react";

// Like Bullet Statuses, this is an app-wide preference, independent of notebooks.
export const listFoldingPreferenceKey = "tigrana.listFolding.v1";
export function readListFoldingPreference() {
  try { return localStorage.getItem(listFoldingPreferenceKey) !== "false"; }
  catch { return true; }
}

export function useListFoldingPreference() {
  const [enabled, setEnabled] = useState(readListFoldingPreference);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === listFoldingPreferenceKey || event.key === null) setEnabled(readListFoldingPreference());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const update = (value: boolean) => {
    try { localStorage.setItem(listFoldingPreferenceKey, String(value)); } catch { /* Keep the in-session setting when storage is unavailable. */ }
    setEnabled(value);
  };
  return [enabled, update] as const;
}
