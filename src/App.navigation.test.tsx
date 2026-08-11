// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
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

function triggerElementResize(target: Element, width: number) {
  resizeObserverRecords.forEach(({ callback, observed, observer }) => {
    if (!observed.has(target)) return;
    callback([{ target, contentRect: { width } } as ResizeObserverEntry], observer);
  });
}

const { demoPersistence, delayedSaves } = vi.hoisted(() => ({
  demoPersistence: new Map<string, string>(),
  delayedSaves: {
    enabled: false,
    markdown: [] as string[],
    releases: [] as Array<() => void>,
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
  storage.saveNote = async (workspace, path, markdown) => {
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

vi.mock("./editor/NotesEditor", () => ({
  NotesEditor: ({
    content,
    notePath,
    onChange,
  }: {
    content: string;
    notePath: string | null;
    onChange: (markdown: string, sourceNotePath: string | null) => void;
  }) => (
    <textarea
      aria-label="Test note body"
      value={content}
      onChange={(event) => onChange(event.target.value, notePath)}
    />
  ),
}));

const { default: App } = await import("./App");

function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => boolean, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
}

describe("Note navigation persistence", () => {
  const containers: HTMLElement[] = [];

  afterEach(() => {
    delayedSaves.enabled = false;
    delayedSaves.releases.splice(0).forEach((release) => release());
    delayedSaves.markdown.length = 0;
    localStorage.clear();
    demoPersistence.clear();
    resizeObserverRecords.clear();
    containers.splice(0).forEach((container) => container.remove());
  });

  it("automatically saves a newer draft that arrives while an older save is in flight", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: [],
      notes: {
        "Welcome.md": "# Welcome\n\nOriginal body.",
      },
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const body = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Test note body"]');
    expect(body).not.toBeNull();
    delayedSaves.enabled = true;

    await act(async () => {
      if (body) setReactTextareaValue(body, "First draft");
    });
    await waitFor(() => delayedSaves.markdown.length === 1);

    await act(async () => {
      if (body) setReactTextareaValue(body, "Second draft");
    });
    expect(container.querySelector(".save-state")?.textContent).toContain("Unsaved");

    await act(async () => delayedSaves.releases.shift()?.());
    await waitFor(() => delayedSaves.markdown.length === 2);
    await act(async () => delayedSaves.releases.shift()?.());
    await waitFor(() => container.querySelector(".save-state")?.textContent?.includes("Saved") ?? false);

    const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as {
      notes?: Record<string, string>;
    };
    expect(store.notes?.["Welcome.md"]).toContain("Second draft");

    await act(async () => root.unmount());
  });

  it.fails("does not navigate away when title validation prevents unsaved body content from being saved", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: [],
      notes: {
        "Welcome.md": "# Welcome\n\nOriginal body.",
        "Other.md": "# Other\n\nNavigation target.",
      },
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });
    await settle();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const title = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note title"]');
    const body = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Test note body"]');
    expect(title?.value).toBe("Welcome");
    expect(body).not.toBeNull();

    await act(async () => {
      if (title) setReactTextareaValue(title, "QA:Invalid title");
      if (body) setReactTextareaValue(body, "UNSAVED-BODY-SENTINEL");
    });

    const other = container.querySelector<HTMLButtonElement>('button[data-note-path="Other.md"]');
    expect(other).not.toBeNull();
    await act(async () => {
      other?.click();
    });
    await settle();

    expect(title?.value).toBe("QA:Invalid title");
    expect(body?.value).toBe("UNSAVED-BODY-SENTINEL");

    await act(async () => root.unmount());
  });

  it("persists a blank new note as an Untitled placeholder", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const newNote = container.querySelector<HTMLButtonElement>('button[title="New note"]');
    expect(newNote).not.toBeNull();
    await act(async () => {
      newNote?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as {
      notes?: Record<string, string>;
    };
    expect(store.notes).toHaveProperty("Untitled.md", "");

    await act(async () => root.unmount());
  });

  it("toggles focus mode from the editor toolbar and restores the prior pane layout", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: [],
      notes: {
        "Welcome.md": "# Welcome\n\nFocus mode test.",
      },
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const findButton = container.querySelector<HTMLButtonElement>('button[title="Find in note"]');
    const focusButton = container.querySelector<HTMLButtonElement>('button[aria-label="Enter focus mode"]');
    const editorOptions = container.querySelector<HTMLButtonElement>('button[title="Editor options"]');
    const rightToggle = container.querySelector<HTMLButtonElement>(".outline-toggle");

    expect(findButton?.nextElementSibling).toBe(focusButton);
    expect(focusButton?.nextElementSibling?.contains(editorOptions ?? null)).toBe(true);
    expect(focusButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => rightToggle?.click());
    expect(container.querySelector("#left-navigation-panes")).not.toBeNull();
    expect(container.querySelector("#right-note-sidebar")).toBeNull();

    await act(async () => focusButton?.click());
    expect(container.querySelector("#left-navigation-panes")).toBeNull();
    expect(container.querySelector("#right-note-sidebar")).toBeNull();
    expect(focusButton?.classList.contains("is-active")).toBe(true);
    expect(focusButton?.getAttribute("aria-label")).toBe("Exit focus mode");
    expect(focusButton?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => focusButton?.click());
    expect(container.querySelector("#left-navigation-panes")).not.toBeNull();
    expect(container.querySelector("#right-note-sidebar")).toBeNull();
    expect(focusButton?.classList.contains("is-active")).toBe(false);
    expect(focusButton?.getAttribute("aria-label")).toBe("Enter focus mode");
    expect(focusButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => root.unmount());
  });

  it("docks a wrapped Note title as soon as the title text leaves the viewport", async () => {
    const longTitle = "A long wrapped title that takes up several lines in the editor";
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: [],
      notes: {
        [`${longTitle}.md`]: "# Body heading\n\nTitle docking test.",
      },
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const surface = container.querySelector<HTMLElement>(".note-surface");
    const titleShell = container.querySelector<HTMLElement>(".title-shell");
    const title = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note title"]');
    expect(surface).not.toBeNull();
    expect(titleShell).not.toBeNull();
    expect(title).not.toBeNull();

    vi.spyOn(surface!, "getBoundingClientRect").mockReturnValue({ top: 58, bottom: 658 } as DOMRect);
    vi.spyOn(title!, "getBoundingClientRect").mockReturnValue({ top: -72, bottom: 58 } as DOMRect);
    vi.spyOn(titleShell!, "getBoundingClientRect").mockReturnValue({ top: -72, bottom: 74 } as DOMRect);

    await act(async () => {
      surface?.dispatchEvent(new Event("scroll"));
    });

    expect(container.querySelector(".topbar-note-title")?.classList.contains("is-visible")).toBe(true);

    await act(async () => root.unmount());
  });

  it("resizes the Note title height when its available width changes", async () => {
    const longTitle = "August 2026 - To Do";
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: [],
      notes: {
        [`${longTitle}.md`]: "# Body heading\n\nResponsive title test.",
      },
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const title = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note title"]');
    expect(title).not.toBeNull();
    let measuredHeight = 47;
    Object.defineProperty(title!, "scrollHeight", {
      configurable: true,
      get: () => measuredHeight,
    });
    title!.style.height = "94px";

    await act(async () => {
      triggerElementResize(title!, 620);
    });
    expect(title!.style.height).toBe("47px");

    measuredHeight = 94;
    await act(async () => {
      triggerElementResize(title!, 360);
    });
    expect(title!.style.height).toBe("94px");

    await act(async () => root.unmount());
  });

  it("navigates backward and forward within a tab and clears a forward branch", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: [],
      notes: {
        "Alpha.md": "# Alpha\n\nFirst note.",
        "Beta.md": "# Beta\n\nSecond note.",
        "Gamma.md": "# Gamma\n\nThird note.",
      },
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const back = container.querySelector<HTMLButtonElement>('button[aria-label="Go back"]');
    const forward = container.querySelector<HTMLButtonElement>('button[aria-label="Go forward"]');
    const title = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note title"]')?.value;
    const clickNote = async (path: string) => {
      await act(async () => {
        container.querySelector<HTMLButtonElement>(`button[data-note-path="${path}"]`)?.click();
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
    };
    const clickHistory = async (button: HTMLButtonElement | null) => {
      await act(async () => {
        button?.click();
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
    };

    expect(title()).toBe("Alpha");
    expect(back?.disabled).toBe(true);
    expect(forward?.disabled).toBe(true);

    await clickNote("Beta.md");
    await clickNote("Gamma.md");
    expect(title()).toBe("Gamma");
    expect(back?.disabled).toBe(false);
    expect(forward?.disabled).toBe(true);

    await clickHistory(back);
    expect(title()).toBe("Beta");
    expect(forward?.disabled).toBe(false);
    await clickHistory(back);
    expect(title()).toBe("Alpha");
    expect(back?.disabled).toBe(true);

    await clickHistory(forward);
    await clickHistory(forward);
    expect(title()).toBe("Gamma");

    await clickHistory(back);
    await clickNote("Alpha.md");
    expect(title()).toBe("Alpha");
    expect(forward?.disabled).toBe(true);

    await act(async () => root.unmount());
  });

  it.each([
    {
      label: "the Note below when deleting the top Note",
      paths: ["Target/Above.md", "Target/Middle.md", "Target/Below.md"],
      deletedPath: "Target/Above.md",
      expectedTitle: "Middle",
    },
    {
      label: "the Note below when deleting from the middle",
      paths: ["Target/Above.md", "Target/Middle.md", "Target/Below.md"],
      deletedPath: "Target/Middle.md",
      expectedTitle: "Below",
    },
    {
      label: "the Note above when deleting the bottom Note",
      paths: ["Target/Above.md", "Target/Middle.md", "Target/Below.md"],
      deletedPath: "Target/Below.md",
      expectedTitle: "Middle",
    },
    {
      label: "no Note when deleting the only Note in a folder",
      paths: ["Target/Only.md"],
      deletedPath: "Target/Only.md",
      expectedTitle: null,
    },
  ])("selects $label without jumping to another folder", async ({ paths, deletedPath, expectedTitle }) => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: ["Other", "Target"],
      notes: {
        "Other/Elsewhere.md": "# Elsewhere\n\nPreviously restored Note.",
        ...Object.fromEntries(paths.map((path) => [path, `# ${path.split("/").at(-1)?.replace(/\.md$/, "")}\n`])),
      },
    }));
    demoPersistence.set("tigrana-meta:/demo/Tigrana", JSON.stringify({
      revision: 0,
      noteOrder: { Target: paths },
      welcomeNoteAdded: true,
    }));
    localStorage.setItem("tigrana-session:/demo/Tigrana", JSON.stringify({
      openTabs: ["Other/Elsewhere.md"],
      activeTab: "Other/Elsewhere.md",
    }));

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const title = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note title"]')?.value ?? null;
    expect(title()).toBe("Elsewhere");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-folder-path="Target"] > button.folder-select')?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-note-path="' + deletedPath + '"]')?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(title()).toBe(deletedPath.split("/").at(-1)?.replace(/\.md$/, ""));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-note-path="' + deletedPath + '"]')
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    });
    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".context-menu button"))
      .find((button) => button.textContent?.includes("Delete Note"));
    expect(deleteButton).toBeDefined();

    await act(async () => {
      deleteButton?.click();
    });
    await waitFor(() => expectedTitle === null
      ? container.querySelector('textarea[aria-label="Note title"]') === null
      : title() === expectedTitle);

    expect(title()).toBe(expectedTitle);
    if (expectedTitle === null) {
      expect(container.querySelector(".welcome-surface")?.textContent).toContain("No note selected");
    }
    expect(title()).not.toBe("Elsewhere");

    await act(async () => root.unmount());
  });
});
