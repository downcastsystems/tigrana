// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { readInitialWorkspace, workspaceKey } from "./notebookSession";
import { SAMPLE_WORKSPACE } from "./notebookStorage";

afterEach(() => { localStorage.clear(); window.history.replaceState(null, "", "/"); });

it("shows startup after deliberately clearing the last notebook instead of restoring the demo", () => {
  expect(readInitialWorkspace()).toBe(SAMPLE_WORKSPACE);
  localStorage.setItem(workspaceKey, "");
  expect(readInitialWorkspace()).toBe("");
});

it("still opens an explicitly requested notebook window", () => {
  localStorage.setItem(workspaceKey, "");
  window.history.replaceState(null, "", "/?workspace=%2FMyNotebook");
  expect(readInitialWorkspace()).toBe("/MyNotebook");
});
