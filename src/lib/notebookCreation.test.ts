import { expect, it } from "vitest";
import { hasRepeatedNotebookName, notebookDestination, notebookNameError } from "./notebookCreation";
it.each(["", ".", "..", "../escape", "a/b", "a\\b", "CON", "LPT1.txt", "trailing.", "a:b"])("rejects unsafe notebook name %s", name => {
  expect(notebookNameError(name)).not.toBeNull();
});
it.each([["/", "/Personal"], ["/Notes/", "/Notes/Personal"], ["C:\\", "C:\\Personal"], ["C:\\Notes", "C:\\Notes\\Personal"], ["\\\\server\\share\\", "\\\\server\\share\\Personal"]])("previews the correct destination under %s", (parent, path) => {
  expect(notebookDestination(parent, " Personal ")).toBe(path);
});
it("detects repeated names across path conventions", () => {
  expect(hasRepeatedNotebookName("/Notes/My Notes/", "my notes")).toBe(true);
  expect(hasRepeatedNotebookName("C:\\Notes\\My Notes", "My Notes")).toBe(true);
  expect(hasRepeatedNotebookName("/Notes", "My Notes")).toBe(false);
});
