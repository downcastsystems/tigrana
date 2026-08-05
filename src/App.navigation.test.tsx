// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};

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
});
