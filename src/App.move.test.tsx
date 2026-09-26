// @vitest-environment jsdom

import { act } from "react";
import type { Editor } from "@tiptap/core";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ResizeObserverRecord = {
  callback: ResizeObserverCallback;
  observed: Set<Element>;
  observer: ResizeObserver;
};

const resizeObserverRecords = new Set<ResizeObserverRecord>();

globalThis.ResizeObserver = class ResizeObserver {
  private record: ResizeObserverRecord;

  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, observed: new Set(), observer: this };
    resizeObserverRecords.add(this.record);
  }

  disconnect() {
    this.record.observed.clear();
    resizeObserverRecords.delete(this.record);
  }

  observe(target: Element) {
    this.record.observed.add(target);
  }

  unobserve(target: Element) {
    this.record.observed.delete(target);
  }

  takeRecords(): ResizeObserverEntry[] {
    return [];
  }
};

const { demoPersistence, delayedSaves, noteLocks, saveFailures } = vi.hoisted(() => ({
  demoPersistence: new Map<string, string>(),
  delayedSaves: {
    enabled: false,
    markdown: [] as string[],
    releases: [] as Array<() => void>,
  },
  saveFailures: {
    attempts: 0,
    remaining: 0,
  },
  noteLocks: {
    denied: false,
  },
}));

const browserPersistence = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    clear: () => browserPersistence.clear(),
    getItem: (key: string) => browserPersistence.get(key) ?? null,
    removeItem: (key: string) => browserPersistence.delete(key),
    setItem: (key: string, value: string) => browserPersistence.set(key, value),
  },
});

vi.mock("./lib/notebookStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/notebookStorage")>();
  const persistence = {
    getItem: (key: string) => demoPersistence.get(key) ?? null,
    setItem: (key: string, value: string) => {
      demoPersistence.set(key, value);
    },
  };
  const storage = actual.createDemoNotebookStorage(persistence);
  const saveNote = storage.saveNote.bind(storage);
  storage.acquireNoteEditLock = async (workspace, path) => noteLocks.denied
    ? {
        acquired: false,
        owner: { windowLabel: "other-window", pid: 1, acquiredAt: 0, workspace, path },
      }
    : { acquired: true };
  storage.saveNote = async (workspace, path, markdown) => {
    saveFailures.attempts += 1;
    if (saveFailures.remaining > 0) {
      saveFailures.remaining -= 1;
      throw new Error("Simulated transient save failure");
    }
    if (delayedSaves.enabled) {
      delayedSaves.markdown.push(markdown);
      await new Promise<void>((resolve) => delayedSaves.releases.push(resolve));
    }
    return saveNote(workspace, path, markdown);
  };
  return {
    ...actual,
    notebookStorage: storage,
  };
});

const { default: App } = await import("./App");
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });

const newBody = "All the newly written meeting notes.";
const readNotes = () => (JSON.parse(demoPersistence.get("tigrana-demo-v5")!) as { notes: Record<string, string> }).notes;

function editorIn(container: HTMLElement) {
  return (container.querySelector(".ProseMirror") as HTMLElement & { editor: Editor }).editor;
}

async function editBody(container: HTMLElement) {
  await act(async () => {
    const paragraph = container.querySelector(".ProseMirror p")!;
    paragraph.textContent = newBody;
    paragraph.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await Promise.resolve();
  });
}

async function openMove(container: HTMLElement, path = "Meetings/Source.md", target = "2026", kind = "note") {
  await act(async () => {
    container.querySelector(`[data-${kind}-path="${path}"]`)!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, button: 2 }),
    );
  });
  await act(async () => {
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Move to…"))!.click();
  });
  await act(async () => {
    Array.from(container.querySelectorAll<HTMLButtonElement>(".move-target-row"))
      .find((button) => button.textContent === target)!.click();
  });
}

async function submitMove(container: HTMLElement) {
  await act(async () => {
    container.querySelector(".move-dialog")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("Note persistence across moves and editor transitions", () => {
  const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

  afterEach(async () => {
    delayedSaves.enabled = false;
    delayedSaves.releases.splice(0).forEach((release) => release());
    for (const { root, container } of mounted.splice(0)) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.useRealTimers();
    saveFailures.attempts = 0;
    saveFailures.remaining = 0;
    delayedSaves.markdown.length = 0;
    noteLocks.denied = false;
    localStorage.clear();
    demoPersistence.clear();
    resizeObserverRecords.clear();
    Reflect.deleteProperty(document, "elementFromPoint");
  });

  async function mount(withOtherNote = false) {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: ["Meetings", "Meetings/2026", "Archive"],
      notes: { "Meetings/Source.md": "# Source\n\nOriginal body.", ...(withOtherNote ? { "Meetings/Other.md": "# Other\n\nOther body." } : {}) },
    }));
    demoPersistence.set("tigrana-meta:/demo/Tigrana", JSON.stringify({
      revision: 0, navigationStyle: "section-view", welcomeNoteAdded: true,
    }));
    localStorage.setItem("tigrana-session:/demo/Tigrana", JSON.stringify({
      openTabs: withOtherNote ? ["Meetings/Source.md", "Meetings/Other.md"] : ["Meetings/Source.md"], activeTab: "Meetings/Source.md",
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    vi.useFakeTimers();
    return container;
  }

  async function toggleMarkdown(container: HTMLElement) {
    await act(async () => container.querySelector<HTMLButtonElement>('[title="Editor options"]')!.click());
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'))
      .find(button => /Show raw Markdown|Show rich editor/.test(button.textContent ?? ""))!.click());
  }

  async function pendingEdit(container: HTMLElement) {
    await act(async () => {
      const editor = editorIn(container);
      editor.commands.selectAll();
      editor.commands.insertContent(newBody);
    });
    // No debounce or autosave timers have run yet.
    expect(readNotes()["Meetings/Source.md"]).not.toContain(newBody);
  }

  it.each(["note", "tab", "close-tab", "new-tab", "markdown-rich"])("preserves an uncommitted typing burst through %s", async transition => {
    const container = await mount(true);
    await pendingEdit(container);
    if (transition === "markdown-rich") {
      await toggleMarkdown(container);
      expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Raw Markdown"]')!.value).toContain(newBody);
      await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find(button => button.textContent === "Return to Rich Editor")!.click());
      expect(editorIn(container).state.doc.textContent).toBe(newBody);
    } else {
      if (transition === "tab" || transition === "close-tab") {
        await act(async () => container.querySelector<HTMLButtonElement>('[title="Open tabs"]')!.click());
      }
      await act(async () => {
        if (transition === "note") container.querySelector<HTMLButtonElement>('[data-note-path="Meetings/Other.md"]')!.click();
        if (transition === "tab") Array.from(container.querySelectorAll<HTMLButtonElement>('.tab-overflow-item'))
          .find(tab => tab.textContent?.includes("Other"))!.click();
        if (transition === "close-tab") container.querySelector<HTMLElement>('.tab-overflow-item.is-active [title="Close tab"]')!.click();
        if (transition === "new-tab") container.querySelector<HTMLButtonElement>('[title="New empty tab"]')!.click();
      });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(readNotes()["Meetings/Source.md"]).toContain(newBody);
    expect(readNotes()["Meetings/Other.md"]).toContain("Other body.");
  });

  it.each(["note", "rich"])("preserves raw Markdown edits through a switch to %s", async transition => {
    const container = await mount(true);
    await toggleMarkdown(container);
    await act(async () => {
      const raw = container.querySelector<HTMLTextAreaElement>('[aria-label="Raw Markdown"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(raw, `# Source\n\n${newBody}`);
      raw.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (transition === "rich") {
      await toggleMarkdown(container);
      expect(editorIn(container).state.doc.textContent).toContain(newBody);
    } else {
      await act(async () => container.querySelector<HTMLButtonElement>('[data-note-path="Meetings/Other.md"]')!.click());
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(readNotes()["Meetings/Source.md"]).toContain(newBody);
  });

  it("blocks navigation with an invalid title instead of discarding the edited body", async () => {
    const container = await mount(true);
    await pendingEdit(container);
    await act(async () => {
      const title = container.querySelector<HTMLTextAreaElement>('[aria-label="Note title"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(title, "Invalid?");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-note-path="Meetings/Other.md"]')!.click());
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Note title"]')!.value).toBe("Invalid?");
    expect(editorIn(container).state.doc.textContent).toBe(newBody);
  });

  it("keeps the latest body when switching away and back while the disk save is delayed", async () => {
    const container = await mount(true);
    delayedSaves.enabled = true;
    await pendingEdit(container);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-note-path="Meetings/Other.md"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-note-path="Meetings/Source.md"]')!.click());
    expect(editorIn(container).state.doc.textContent).toBe(newBody);
    delayedSaves.enabled = false;
    await act(async () => { delayedSaves.releases.splice(0).forEach(release => release()); await vi.advanceTimersByTimeAsync(2000); });
    expect(readNotes()["Meetings/Source.md"]).toContain(newBody);
    expect(readNotes()["Meetings/Other.md"]).toContain("Other body.");
  });

  it("preserves frontmatter and supported Markdown through repeated mode switches and reopening", async () => {
    const container = await mount(true);
    const content = "---\ncustom_field: keep-me\n---\n\n## Meeting notes\n\n- [ ] Follow up\n- [x] Sent\n\n1. First\n2. Second\n\n```js\nconst total = 42;\n```\n\n[Reference](Other.md)\n\n2147483648. Literal number";
    await toggleMarkdown(container);
    await act(async () => {
      const raw = container.querySelector<HTMLTextAreaElement>('[aria-label="Raw Markdown"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(raw, content);
      raw.dispatchEvent(new Event("input", { bubbles: true }));
    });
    for (let cycle = 0; cycle < 3; cycle++) {
      await toggleMarkdown(container);
      expect(editorIn(container).state.doc.textContent).toContain("const total = 42;");
      await toggleMarkdown(container);
      const raw = container.querySelector<HTMLTextAreaElement>('[aria-label="Raw Markdown"]')!.value;
      expect(raw).toContain("custom_field: keep-me");
      expect(raw).toContain("2147483648. Literal number");
      expect(raw).toContain("- [x] Sent");
      expect(raw).toContain("[Reference](Other.md)");
    }
    await act(async () => container.querySelector<HTMLButtonElement>('[data-note-path="Meetings/Other.md"]')!.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    const saved = readNotes()["Meetings/Source.md"];
    expect(saved).toContain("custom_field: keep-me");
    expect(saved).toContain("const total = 42;");
    const app = mounted.find(entry => entry.container === container)!;
    await act(async () => app.root.unmount());
    app.root = createRoot(container);
    await act(async () => app.root.render(<App />));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-note-path="Meetings/Source.md"]')!.click());
    expect(editorIn(container).state.doc.textContent).toContain("2147483648. Literal number");
    expect(editorIn(container).state.doc.textContent).toContain("const total = 42;");
    expect(readNotes()["Meetings/Source.md"]).toBe(saved);
  });

  it.each([0, 1000])("preserves the editor body with %i ms before Move", async (saveDelay) => {
    const container = await mount();
    await editBody(container);
    await act(async () => { await vi.advanceTimersByTimeAsync(saveDelay); });
    await openMove(container);
    await submitMove(container);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(readNotes()["Meetings/2026/Source.md"]).toContain(newBody);
    expect(readNotes()["Meetings/Source.md"]).toBeUndefined();
  });

  it("captures a DOM-only accessibility replacement even when no change was observed", async () => {
    const container = await mount();
    const editor = editorIn(container);
    const observer = (editor.view as unknown as { domObserver: { stop(): void; start(): void } }).domObserver;
    observer.stop();
    editor.view.dom.innerHTML = `<p>${newBody}</p><p>Second paragraph.</p>`;
    observer.start();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(editor.state.doc.textContent).toContain("Original body.");
    expect(readNotes()["Meetings/Source.md"]).not.toContain(newBody);
    await openMove(container);
    await submitMove(container);
    expect(readNotes()["Meetings/2026/Source.md"]).toContain(newBody);
    expect(readNotes()["Meetings/2026/Source.md"]).toContain("Second paragraph.");
  });

  it("saves an accessibility title change and moves the resulting renamed file", async () => {
    const container = await mount();
    await editBody(container);
    const title = container.querySelector<HTMLTextAreaElement>('[aria-label="Note title"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(title, "Weekly summary");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await openMove(container);
    await submitMove(container);
    expect(readNotes()["Meetings/2026/Weekly summary.md"]).toContain(newBody);
    expect(readNotes()["Meetings/Source.md"]).toBeUndefined();
    expect(readNotes()["Meetings/Weekly summary.md"]).toBeUndefined();
  });

  it("refuses to move an unsaved Note with an invalid title", async () => {
    const container = await mount();
    await editBody(container);
    await act(async () => {
      const title = container.querySelector<HTMLTextAreaElement>('[aria-label="Note title"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(title, "Invalid?");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await openMove(container);
    await submitMove(container);
    expect(readNotes()["Meetings/2026/Source.md"]).toBeUndefined();
    expect(readNotes()["Meetings/Source.md"]).toContain("Original body.");
    expect(editorIn(container).state.doc.textContent).toContain(newBody);
    expect(container.querySelector(".dialog-error")).not.toBeNull();
    expect(editorIn(container).isEditable).toBe(true);
  });

  it("leaves the Note and edits in place when saving fails, then allows retry", async () => {
    const container = await mount();
    await editBody(container);
    saveFailures.remaining = 1;
    await openMove(container);
    await submitMove(container);
    expect(readNotes()["Meetings/2026/Source.md"]).toBeUndefined();
    expect(readNotes()["Meetings/Source.md"]).toContain("Original body.");
    expect(editorIn(container).state.doc.textContent).toContain(newBody);
    expect(container.querySelector(".dialog-error")?.textContent).toContain("Simulated transient save failure");
    expect(container.querySelector<HTMLElement>(".app-shell")!.inert).toBe(false);
    expect(editorIn(container).isEditable).toBe(true);
    await submitMove(container);
    expect(readNotes()["Meetings/2026/Source.md"]).toContain(newBody);
  });

  it("waits for an in-flight save and freezes input until the file has moved", async () => {
    const container = await mount();
    await editBody(container);
    delayedSaves.enabled = true;
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "s" }));
    });
    expect(delayedSaves.releases).toHaveLength(1);
    await openMove(container);
    await submitMove(container);
    expect(readNotes()["Meetings/2026/Source.md"]).toBeUndefined();
    expect(container.querySelector<HTMLElement>(".app-shell")!.inert).toBe(true);
    expect(editorIn(container).isEditable).toBe(false);
    await act(async () => {
      delayedSaves.enabled = false;
      delayedSaves.releases.splice(0).forEach((release) => release());
    });
    expect(readNotes()["Meetings/2026/Source.md"]).toContain(newBody);
    expect(readNotes()["Meetings/Source.md"]).toBeUndefined();
    expect(editorIn(container).isEditable).toBe(true);
  });

  it("saves the active Note before moving its containing folder", async () => {
    const container = await mount();
    await editBody(container);
    await openMove(container, "Meetings", "Archive", "folder");
    await submitMove(container);
    expect(readNotes()["Archive/Meetings/Source.md"]).toContain(newBody);
    expect(readNotes()["Meetings/Source.md"]).toBeUndefined();
  });
  it("saves the active Note before renaming its containing folder", async () => {
    const container = await mount();
    await editBody(container);
    await act(async () => {
      container.querySelector('[data-folder-path="Meetings"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Rename Folder")!.click();
    });
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>("#property-value")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form.dialog")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(readNotes()["Renamed/Source.md"]).toContain(newBody);
    expect(readNotes()["Meetings/Source.md"]).toBeUndefined();
  });

  it("saves pending editor content when a Note is dragged into a folder", async () => {
    const container = await mount();
    await editBody(container);
    const source = container.querySelector<HTMLElement>('[data-note-path="Meetings/Source.md"]')!;
    const target = container.querySelector<HTMLElement>('[data-folder-path="Meetings/2026"]')!;
    target.getBoundingClientRect = () => new DOMRect(0, 100, 240, 40);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    await act(async () => {
      source.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20 }));
      window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 40, clientY: 120 }));
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 40, clientY: 120 }));
    });
    expect(readNotes()["Meetings/2026/Source.md"]).toContain(newBody);
    expect(readNotes()["Meetings/Source.md"]).toBeUndefined();
  });

});
