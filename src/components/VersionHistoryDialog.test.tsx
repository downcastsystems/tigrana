// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
const storage = vi.hoisted(() => ({ listNoteVersions: vi.fn(), readNoteVersion: vi.fn() }));
vi.mock("../lib/notebookStorage", () => ({ notebookStorage: storage }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const version = (id: string) => ({ id, path: "Large.md", title: "Large", createdAt: 0, reason: "save", contentLength: 3_200_000 });
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  storage.listNoteVersions.mockReset(); storage.readNoteVersion.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render() {
  await act(async () => root.render(<VersionHistoryDialog activeNoteEditable note={{ path: "Large.md", title: "Large" }}
    workspace="/Notebook" onClose={() => undefined} onRestore={() => undefined} />));
}
const retry = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry')!;
it("stops a stalled list request, allows retry, and ignores its late response", async () => {
  let finish!: (entries: ReturnType<typeof version>[]) => void;
  storage.listNoteVersions.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([version('new')]);
  storage.readNoteVersion.mockResolvedValue('Current successful preview');
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(container.textContent).not.toContain('Loading…');
  expect(container.textContent).toContain('taking longer than expected');
  await act(async () => retry().click());
  expect(container.querySelector('pre')?.textContent).toBe('Current successful preview');
  await act(async () => finish([version('old')]));
  expect(storage.readNoteVersion).toHaveBeenCalledTimes(1);
  expect(storage.readNoteVersion).toHaveBeenCalledWith('/Notebook', 'Large.md', 'new');
});
it("stops a stalled preview and retries without reloading the version list", async () => {
  storage.listNoteVersions.mockResolvedValue([version('v1')]);
  storage.readNoteVersion.mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValueOnce('Recovered preview');
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(container.textContent).not.toContain('Loading preview…');
  expect(container.textContent).toContain('taking longer than expected');
  await act(async () => retry().click());
  expect(container.querySelector('pre')?.textContent).toBe('Recovered preview');
  expect(storage.listNoteVersions).toHaveBeenCalledTimes(1);
});
it("keeps a full large version available without truncation", async () => {
  const content = `${'Large note paragraph.\n\n'.repeat(150000)}END OF VERSION`;
  storage.listNoteVersions.mockResolvedValue([version('v1')]); storage.readNoteVersion.mockResolvedValue(content);
  await render();
  expect(container.querySelector('pre')?.textContent).toBe(content);
  expect(container.textContent).not.toContain('Loading');
});
