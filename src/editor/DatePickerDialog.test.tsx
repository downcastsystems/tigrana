// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { DatePickerDialog } from "./DatePickerDialog";
import { DateFormatSetting } from "../components/DateFormatSetting";
import { dateFormatStorageKey, writeDateFormat } from "../lib/dateFormat";
import { formatInsertedDate, requestDate, shiftCalendarMonth } from "./dateInsertion";



(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
const { filterSlashCommands } = await import("./slashCommands");
const { htmlToMarkdown } = await import("../lib/markdown");
let editor: Editor, root: Root, mount: HTMLDivElement, host: HTMLDivElement;
async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 29, 23, 30));
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  host = document.createElement("div"); mount = document.createElement("div"); document.body.append(host, mount);
  editor = new Editor({ element: host, extensions: [StarterKit], content: "<p>Before /date after</p>" });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 20, left: 0, right: 10 });
  root = createRoot(mount);
  await act(async () => root.render(<DatePickerDialog editor={editor} disabled={false} />));
}
async function open() {
  await act(async () => filterSlashCommands("date")[0].run(editor, { from: 8, to: 13 }, {}));
}
async function key(key: string, shiftKey = false) {
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));
}
afterEach(async () => {
  await act(async () => root?.unmount()); localStorage.clear(); editor?.destroy(); host?.remove(); mount?.remove(); vi.restoreAllMocks(); vi.useRealTimers();
});
it("opens /date with today focused, inserts plain text on Enter, and supports undo", async () => {
  await setup(); await open();
  expect(document.activeElement?.getAttribute("aria-current")).toBe("date");
  expect(document.activeElement?.getAttribute("aria-pressed")).toBe("true");
  await key("Enter");
  expect(htmlToMarkdown(editor.getHTML()).trim()).toBe(`Before ${formatInsertedDate(new Date())} after`);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => { editor.commands.undo(); });
  expect(editor.getText()).toBe("Before /date after");
});
it("navigates across months with arrows and inserts a clicked date", async () => {
  await setup(); await open();
  await key("ArrowDown");
  expect(document.activeElement?.textContent).toBe("6");
  expect(document.querySelector('.date-picker-month strong')?.textContent).toContain("October");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.date-picker-day')].find(button => button.textContent === "15")!.click());
  await key("Enter");
  expect(editor.getText()).toBe(`Before ${formatInsertedDate(new Date(2026, 9, 15))} after`);
});
it("cancels unchanged with Escape, closes on replacement, and rejects read-only requests", async () => {
  await setup(); await open(); await key("Escape");
  expect(editor.getText()).toBe("Before /date after");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await open();
  await act(async () => editor.commands.setContent("<p>Another note</p>"));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  editor.setEditable(false);
  await act(async () => requestDate(editor));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("clamps month navigation at leap-day boundaries and formats regional date order", () => {
  expect(shiftCalendarMonth(new Date(2024, 0, 31), 1)).toEqual(new Date(2024, 1, 29));
  expect(shiftCalendarMonth(new Date(2025, 0, 31), 1)).toEqual(new Date(2025, 1, 28));
  expect(shiftCalendarMonth(new Date(2026, 11, 31), 1)).toEqual(new Date(2027, 0, 31));
  const date = new Date(2026, 8, 29);
  expect(formatInsertedDate(date, "en-US")).toBe("9/29/2026");
  expect(formatInsertedDate(date, "en-GB")).toBe("29/09/2026");
  expect(formatInsertedDate(date, "ja-JP")).toBe("2026/9/29");
});
it("keeps Tab inside the calendar", async () => {
  await setup(); await open();
  await act(async () => document.querySelector<HTMLButtonElement>('.date-picker-insert')!.focus());
  await key("Tab");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Cancel date insertion");
  await key("Tab", true);
  expect(document.activeElement?.className).toBe("date-picker-insert");
});

it("uses the app-wide Settings choice for the calendar preview and inserted text", async () => {
  await setup();
  await act(async () => root.render(<><DateFormatSetting /><DatePickerDialog editor={editor} disabled={false} /></>));
  const dropdown = document.querySelector<HTMLSelectElement>('[aria-label="Date format"]')!;
  expect(dropdown.value).toBe("locale");
  await act(async () => {
    dropdown.value = "yyyy-mm-dd";
    dropdown.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(localStorage.getItem(dateFormatStorageKey)).toBe("yyyy-mm-dd");
  await open();
  expect(document.querySelector('.date-picker-insert')?.textContent).toBe("Insert 2026-09-29");
  await key("Enter");
  expect(editor.getText()).toBe("Before 2026-09-29 after");
});
it("adopts format changes from another window and from the current window", async () => {
  await setup(); await open();
  await act(async () => {
    localStorage.setItem(dateFormatStorageKey, "dd/mm/yyyy");
    window.dispatchEvent(new StorageEvent("storage", { key: dateFormatStorageKey }));
  });
  expect(document.querySelector('.date-picker-insert')?.textContent).toBe("Insert 29/09/2026");
  await act(async () => writeDateFormat("yyyy/mm/dd"));
  expect(document.querySelector('.date-picker-insert')?.textContent).toBe("Insert 2026/09/29");
});
