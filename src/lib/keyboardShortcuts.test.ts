import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appShortcutCommand } from "./keyboardShortcuts";

const nativeMenu = readFileSync(new URL("../../src-tauri/src/main.rs", import.meta.url), "utf8");

describe("native shortcut contract", () => {
  it("uses portable modifiers for every custom menu accelerator", () => {
    expect(nativeMenu.match(/Some\("(?:Cmd|Command|Super|Meta)\+/g)).toBeNull();
  });

  it("builds Windows releases as GUI applications", () => {
    expect(nativeMenu.includes('#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]')).toBe(true);
  });
});

const base = { key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, defaultPrevented: false };

it.each(["ctrlKey", "metaKey"] as const)("matches every custom menu command with %s", modifier => {
  const accelerators = [...nativeMenu.matchAll(/Some\("CmdOrCtrl\+([^"\n]+)"\)/g)].map(match => match[1]);
  for (const accelerator of accelerators) {
    const parts = accelerator.split("+");
    const key = parts.at(-1)!;
    // Panes and zoom have separate UI tests; window actions are native-only.
    if (["/", "\\\\", "=", "-", "0", "Q", "M"].includes(key)) continue;
    expect(appShortcutCommand({ ...base, [modifier]: true, shiftKey: parts.includes("Shift"), altKey: parts.includes("Alt"), key: key === "Period" ? "." : key }), accelerator).not.toBeNull();
  }
});

it.each(["ctrlKey", "metaKey"] as const)("distinguishes shifted commands with %s", modifier => {
  const event = { ...base, [modifier]: true };
  expect(appShortcutCommand({ ...event, key: "n" })).toBe("new_note");
  expect(appShortcutCommand({ ...event, key: "N", shiftKey: true })).toBe("new_folder");
  expect(appShortcutCommand({ ...event, key: "k" })).toBe("search_notebook");
  expect(appShortcutCommand({ ...event, key: "K", shiftKey: true })).toBe("format_link");
  for (const key of ["s", "t", "i", "b"]) {
    expect(appShortcutCommand({ ...event, key, shiftKey: true })).toBeNull();
  }
  expect(appShortcutCommand({ ...event, key: ".", altKey: true })).toBe("sort_bullet_method");
  expect(appShortcutCommand({ ...event, key: "≥", code: "Period", altKey: true })).toBe("sort_bullet_method");
  expect(appShortcutCommand({ ...event, key: ".", altKey: true, shiftKey: true })).toBeNull();
});

it("leaves typing, composition, and already handled editor shortcuts alone", () => {
  expect(appShortcutCommand({ ...base, key: "n" })).toBeNull();
  expect(appShortcutCommand({ ...base, key: "n", ctrlKey: true, isComposing: true })).toBeNull();
  expect(appShortcutCommand({ ...base, key: "b", ctrlKey: true, defaultPrevented: true })).toBeNull();
  expect(appShortcutCommand({ ...base, key: "n", ctrlKey: true, metaKey: true })).toBeNull();
});
