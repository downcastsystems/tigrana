// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../lib/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/search")>();
  return { ...actual, searchNotes: vi.fn(actual.searchNotes) };
});
import { searchNotes } from "../lib/search";
import { GlobalSearchModal } from "./GlobalSearchModal";
import { defaultWorkspaceMetadata } from "../lib/notebookStorage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("previews and highlights the matching passage instead of the beginning of a long note", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const notes = [{ path: "Long.md", title: "Long note", parent_path: "" }];
  const contents = new Map([["Long.md", `${'Opening paragraph. '.repeat(100)}\n\nPage 7777 is a different reference.\n\n## Page 777\n\nThe relevant passage.`]]);
  const noop = () => undefined;
  const render = (query: string) => <GlobalSearchModal notes={notes} contents={contents} query={query}
    metadata={defaultWorkspaceMetadata()} folders={[]} focusRequest={0} onClose={noop} onQueryChange={noop} onSelect={noop} />;
  try {
    await act(async () => root.render(render("page 777")));
    const paper = container.querySelector(".search-preview-paper")!;
    expect(paper.querySelector("mark")?.textContent).toBe("Page 777");
    expect(paper.querySelector("mark")?.nextSibling?.textContent).not.toMatch(/^7/);
    expect(paper.textContent).toContain("The relevant passage.");
    await act(async () => root.render(render("")));
    expect(container.querySelector(".search-preview-paper p")?.textContent).toMatch(/^Opening paragraph/);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});


it("debounces typing, keeps displayed highlights consistent, and clears immediately", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const notes = [{ path: "Long.md", title: "Long note", parent_path: "" }];
  const contents = new Map([["Long.md", "Page 77 and Page 777"]]);
  const metadata = defaultWorkspaceMetadata();
  const onSelect = vi.fn();
  const render = async (query: string) => act(async () => root.render(<GlobalSearchModal notes={notes} contents={contents}
    metadata={metadata} folders={[]} query={query} focusRequest={0} onClose={() => undefined}
    onQueryChange={() => undefined} onSelect={onSelect} />));
  try {
    await render("page 77");
    vi.mocked(searchNotes).mockClear();
    await render("page 7");
    await act(async () => vi.advanceTimersByTime(80));
    await render("page 777");
    await act(async () => vi.advanceTimersByTime(119));
    expect(searchNotes).not.toHaveBeenCalled();
    expect(container.querySelector("input")?.value).toBe("page 777");
    expect(container.querySelector(".search-preview-paper mark")?.textContent).toBe("Page 77");
    // A visible old result carries its own query to the Note jump/highlight.
    await act(async () => container.querySelector<HTMLButtonElement>(".global-search-result")!.click());
    expect(onSelect).toHaveBeenLastCalledWith("Long.md", "page 77");
    await act(async () => vi.advanceTimersByTime(1));
    expect(searchNotes).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".search-preview-paper mark")?.textContent).toBe("Page 777");
    await render("");
    expect(container.querySelector(".search-preview-paper mark")).toBeNull();
    expect(container.querySelector('[aria-label="Recent notes"]')).not.toBeNull();
    await render("pending");
    vi.mocked(searchNotes).mockClear();
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTime(200));
    expect(searchNotes).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers();
  }
});

it("Enter opens a match for the latest input during the debounce window", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const notes = [{ path: "Old.md", title: "Page 77", parent_path: "" }, { path: "New.md", title: "Page 777", parent_path: "" }];
  const contents = new Map<string, string>();
  const metadata = defaultWorkspaceMetadata();
  const onSelect = vi.fn();
  const render = async (query: string) => act(async () => root.render(<GlobalSearchModal notes={notes} contents={contents}
    metadata={metadata} folders={[]} query={query} focusRequest={0} onClose={() => undefined}
    onQueryChange={() => undefined} onSelect={onSelect} />));
  try {
    await render("page 77"); await render("page 777");
    await act(async () => container.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith("New.md", "page 777");
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers();
  }
});
