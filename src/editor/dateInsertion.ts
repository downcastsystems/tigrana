import type { Editor, Range } from "@tiptap/core";
import { formatDate, type DateFormat } from "../lib/dateFormat";

export const dateInsertEvent = "tigrana-insert-date";

export function requestDate(editor: Editor, range: Range = editor.state.selection) {
  if (!editor.isEditable) return;
  editor.view.dom.dispatchEvent(new CustomEvent<Range>(dateInsertEvent, { detail: { from: range.from, to: range.to } }));
}

export function formatInsertedDate(date: Date, locale?: string, format: DateFormat = "locale") {
  return formatDate(date, format, locale);
}

export function shiftCalendarMonth(date: Date, delta: number) {
  const first = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(date.getDate(), lastDay));
  return first;
}
