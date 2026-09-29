export const dateFormats = ["locale", "m/d/yyyy", "mm/dd/yyyy", "d/m/yyyy", "dd/mm/yyyy", "yyyy-mm-dd", "yyyy/mm/dd"] as const;
export type DateFormat = typeof dateFormats[number];
export const dateFormatStorageKey = "tigrana-date-format";
export const dateFormatChangedEvent = "tigrana-date-format-changed";

export function isDateFormat(value: unknown): value is DateFormat {
  return dateFormats.some(format => format === value);
}

export function readDateFormat(): DateFormat {
  try {
    const saved = localStorage.getItem(dateFormatStorageKey);
    return isDateFormat(saved) ? saved : "locale";
  } catch {
    return "locale";
  }
}

export function writeDateFormat(format: DateFormat) {
  localStorage.setItem(dateFormatStorageKey, format);
  window.dispatchEvent(new Event(dateFormatChangedEvent));
}

export function formatDate(date: Date, format: DateFormat = "locale", locale?: string) {
  if (format === "locale") {
    // The locale's default date format keeps US month/day numbers unpadded.
    return new Intl.DateTimeFormat(locale, { calendar: "gregory" }).format(date);
  }
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());
  const year = String(date.getFullYear()).padStart(4, "0");
  switch (format) {
    case "m/d/yyyy": return `${month}/${day}/${year}`;
    case "mm/dd/yyyy": return `${month.padStart(2, "0")}/${day.padStart(2, "0")}/${year}`;
    case "d/m/yyyy": return `${day}/${month}/${year}`;
    case "dd/mm/yyyy": return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
    case "yyyy-mm-dd": return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    case "yyyy/mm/dd": return `${year}/${month.padStart(2, "0")}/${day.padStart(2, "0")}`;
  }
}
