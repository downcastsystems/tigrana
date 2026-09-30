// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NoteTitleInput } from "./NoteTitleInput";
import { writeDateFormat } from "../lib/dateFormat";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const commit = vi.fn();
const blur = vi.fn();
function Harness({ documentKey = "one", disabled = false, initial = "Meeting /date notes" }) {
  const [value, setValue] = useState(initial);
  return <NoteTitleInput value={value} documentKey={documentKey} disabled={disabled}
    onChange={event => setValue(event.target.value)} onInsertDate={setValue}
    onKeyDown={commit} onCommit={commit} onBlur={blur} aria-label="Note title" />;
}
async function setup(initial?: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 30, 23, 30));
  writeDateFormat("yyyy-mm-dd");
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness initial={initial} />));
  const input = host.querySelector("textarea")!;
  await act(async () => { input.setSelectionRange(13, 13); input.focus(); });
  return input;
}
async function key(key: string, isComposing = false) {
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
    key, isComposing, bubbles: true, cancelable: true,
  })));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove(); localStorage.clear(); vi.useRealTimers(); vi.clearAllMocks();
});

it("replaces only /date at the caret, preserves the suffix, and delays title commit until the next Enter", async () => {
  const input = await setup();
  await key("Enter");
  expect(document.activeElement?.getAttribute("aria-current")).toBe("date");
  expect(blur).toHaveBeenCalledOnce();
  expect(commit).not.toHaveBeenCalled();
  await key("Enter");
  expect(input.value).toBe("Meeting 2026-09-30 notes");
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(18);
  expect(commit).not.toHaveBeenCalled();
  await key("Enter");
  expect(commit).toHaveBeenCalledOnce();
});

it("supports clicking the command and selecting another day with the configured slash format", async () => {
  const input = await setup("/date");
  await act(async () => writeDateFormat("m/d/yyyy"));
  await act(async () => host.querySelector<HTMLButtonElement>(".title-date-command")!.click());
  await key("ArrowRight");
  await key("Enter");
  expect(input.value).toBe("10/1/2026");
  expect(document.activeElement).toBe(input);
});

it("cancels with Escape without changing or committing the title", async () => {
  const input = await setup();
  await key("Tab"); await key("Escape");
  expect(input.value).toBe("Meeting /date notes");
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(13);
  expect(commit).not.toHaveBeenCalled();
  expect(blur).toHaveBeenCalledOnce();
});

it.each(["folder/date", "/datetime", "ordinary title"])("keeps normal title behavior for %s", async initial => {
  await setup(initial); await key("Enter");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(commit).toHaveBeenCalledOnce();
});

it("does not consume IME confirmation or a selected range", async () => {
  const input = await setup();
  await key("Enter", true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(commit).not.toHaveBeenCalled();
  await act(async () => input.setSelectionRange(8, 13));
  await key("Enter");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(commit).toHaveBeenCalledOnce();
});

it.each(["switch", "disable"])("dismisses an open calendar on %s even with identical title text", async action => {
  await setup(); await key("Enter");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => root.render(<Harness documentKey={action === "switch" ? "two" : "one"} disabled={action === "disable"} />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
