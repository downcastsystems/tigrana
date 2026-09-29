import { useSyncExternalStore } from "react";
import { dateFormatChangedEvent, dateFormatStorageKey, readDateFormat } from "./dateFormat";

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === dateFormatStorageKey || event.key === null) onChange();
  };
  window.addEventListener(dateFormatChangedEvent, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(dateFormatChangedEvent, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

// Like app zoom, this preference belongs to the app, not a notebook's metadata.
export function useDateFormat() {
  return useSyncExternalStore(subscribe, readDateFormat, () => "locale" as const);
}
