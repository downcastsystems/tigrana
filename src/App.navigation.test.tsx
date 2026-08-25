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

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pointerEvent(type: string, clientX: number, clientY: number) {
  return new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX, clientY });
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
    saveFailures.attempts = 0;
    saveFailures.remaining = 0;
    noteLocks.denied = false;
    localStorage.clear();
    demoPersistence.clear();
    resizeObserverRecords.clear();
    Reflect.deleteProperty(document, "elementFromPoint");
    vi.restoreAllMocks();
    containers.splice(0).forEach((container) => container.remove());
  });

  it("offers the section and active nested folder from the Note-list add menu", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: ["Meetings", "Meetings/August 2026"],
      notes: {
        "Meetings/Overview.md": "# Overview\n",
        "Meetings/August 2026/Planning.md": "# Planning\n",
      },
    }));
    demoPersistence.set("tigrana-meta:/demo/Tigrana", JSON.stringify({
      revision: 0,
      navigationStyle: "section-view",
      expandedFolders: { "Meetings/August 2026": true },
      welcomeNoteAdded: true,
    }));
    localStorage.setItem("tigrana-session:/demo/Tigrana", JSON.stringify({
      openTabs: ["Meetings/August 2026/Planning.md"],
      activeTab: "Meetings/August 2026/Planning.md",
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });

    const createButton = container.querySelector<HTMLButtonElement>(".unified-tree-pane .pane-create-button");
    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
    });
    const menuButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".pane-create-menu button"));
    const actions = menuButtons.map((button) => button.textContent?.trim());

    expect(document.activeElement).not.toBe(menuButtons[0]);
    expect(actions).toEqual([
      "New Note in Meetings",
      "New Note in August 2026",
      "New Folder in Meetings",
      "New Folder in August 2026",
    ]);
    const separator = container.querySelector<HTMLElement>('.pane-create-menu [role="separator"]');
    expect(separator?.previousElementSibling).toBe(menuButtons[1]);
    expect(separator?.nextElementSibling).toBe(menuButtons[2]);

    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
    });
    await act(async () => {
      container.querySelector<HTMLElement>(".unified-tree-scroll")?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 500,
        clientY: 700,
      }));
    });
    const contextMenuButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".context-menu button"));
    const contextMenuSeparator = container.querySelector<HTMLElement>('.context-menu [role="separator"]');
    expect(contextMenuSeparator?.previousElementSibling).toBe(contextMenuButtons[1]);
    expect(contextMenuSeparator?.nextElementSibling).toBe(contextMenuButtons[2]);
    await act(async () => {
      contextMenuButtons[2]?.click();
    });
    expect(container.querySelector(".dialog h2")?.textContent).toBe("New folder");
    expect(container.querySelector<HTMLInputElement>("#folder-name")?.placeholder).toBe("Folder name");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.dialog button[title="Close"]')?.click();
    });
    createButton?.focus();
    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    const keyboardMenuButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".pane-create-menu button"));
    expect(document.activeElement).toBe(keyboardMenuButtons[0]);
    await act(async () => {
      keyboardMenuButtons[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect(document.activeElement).toBe(keyboardMenuButtons[1]);
    await act(async () => {
      keyboardMenuButtons[1]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(document.activeElement).toBe(keyboardMenuButtons[3]);
    await act(async () => {
      keyboardMenuButtons[3]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    expect(document.activeElement).toBe(keyboardMenuButtons[0]);
    await act(async () => {
      keyboardMenuButtons[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });
    expect(document.activeElement).toBe(keyboardMenuButtons[3]);

    await act(async () => {
      keyboardMenuButtons[1]?.click();
    });
    await waitFor(() => {
      const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as { notes?: Record<string, string> };
      return Object.prototype.hasOwnProperty.call(store.notes, "Meetings/August 2026/Untitled.md");
    });
    const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as { notes?: Record<string, string> };
    expect(store.notes?.["Meetings/Untitled.md"]).toBeUndefined();

    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
    });
    const nestedFolderAction = Array.from(container.querySelectorAll<HTMLButtonElement>(".pane-create-menu button"))
      .find((button) => button.textContent?.trim() === "New Folder in August 2026");
    expect(nestedFolderAction).toBeDefined();
    await act(async () => {
      nestedFolderAction?.click();
    });
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>("#folder-name");
      if (input) setReactInputValue(input, "Follow Ups");
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>(".dialog")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await waitFor(() => {
      const nextStore = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as { folders?: string[] };
      return nextStore.folders?.includes("Meetings/August 2026/Follow Ups") ?? false;
    });
    const nextStore = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as { folders?: string[] };
    expect(nextStore.folders).not.toContain("Meetings/Follow Ups");

    await act(async () => root.unmount());
  });

  it("opens section actions from the Note-list section title", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: ["Battle Plans", "Battle Plans/2026"],
      notes: {
        "Battle Plans/2026/May.md": "# May\n",
      },
    }));
    demoPersistence.set("tigrana-meta:/demo/Tigrana", JSON.stringify({
      revision: 0,
      navigationStyle: "section-view",
      expandedFolders: { "Battle Plans/2026": true },
      welcomeNoteAdded: true,
    }));
    localStorage.setItem("tigrana-session:/demo/Tigrana", JSON.stringify({
      openTabs: ["Battle Plans/2026/May.md"],
      activeTab: "Battle Plans/2026/May.md",
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });

    const sectionTitle = Array.from(container.querySelectorAll<HTMLElement>(".unified-tree-pane .pane-header strong"))
      .find((element) => element.textContent === "Battle Plans");
    expect(sectionTitle).toBeDefined();

    const sectionsPane = container.querySelector<HTMLElement>(".section-view-folder-pane");
    await act(async () => {
      sectionsPane?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 30,
        clientY: 700,
      }));
    });
    const emptyPaneActions = Array.from(container.querySelectorAll<HTMLButtonElement>(".context-menu button"))
      .map((button) => button.textContent?.trim());
    expect(emptyPaneActions.filter((action) => action?.startsWith("New Section"))).toEqual(["New Section"]);

    const sectionRow = container.querySelector<HTMLElement>('.section-view-folder-pane [data-folder-path="Battle Plans"]');
    await act(async () => {
      sectionRow?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 40,
        clientY: 80,
      }));
    });
    const sectionRowActions = Array.from(container.querySelectorAll<HTMLButtonElement>(".context-menu button"))
      .map((button) => button.textContent?.trim());
    expect(sectionRowActions).toContain("New Folder in Battle Plans");
    expect(sectionRowActions.filter((action) => action?.startsWith("New Section"))).toEqual(["New Section"]);

    await act(async () => {
      sectionTitle?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 40,
        clientY: 40,
      }));
    });

    const actions = Array.from(container.querySelectorAll<HTMLButtonElement>(".context-menu button"))
      .map((button) => button.textContent?.trim());
    expect(actions).toContain("Rename Folder");
    expect(actions).toContain("Change Section Icon");
    expect(actions).toContain("Change Section Color");
    expect(actions).toContain("Delete Section");
    expect(actions).not.toContain("Change Folder Icon");
    expect(actions).not.toContain("Delete Folder");

    const renameButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".context-menu button"))
      .find((button) => button.textContent?.trim() === "Rename Folder");
    await act(async () => {
      renameButton?.click();
    });
    expect(container.querySelector<HTMLInputElement>("#property-value")?.value).toBe("Battle Plans");

    await act(async () => root.unmount());
  });

  it("opens folder actions after creating a section and nested folder", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({ folders: [], notes: {} }));
    demoPersistence.set("tigrana-meta:/demo/Tigrana", JSON.stringify({
      revision: 0,
      navigationStyle: "section-view",
      welcomeNoteAdded: true,
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.section-view-folder-pane button[title="New Section"]')?.click();
    });
    expect(container.querySelector(".dialog h2")?.textContent).toBe("New section");
    expect(container.querySelector<HTMLInputElement>("#folder-name")?.placeholder).toBe("Section name");
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>("#folder-name");
      if (input) setReactInputValue(input, "New Section");
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>(".dialog")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await waitFor(() => {
      const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as { folders?: string[] };
      return store.folders?.includes("New Section") ?? false;
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".unified-tree-pane .pane-create-button")?.click();
    });
    const newFolder = Array.from(container.querySelectorAll<HTMLButtonElement>(".pane-create-menu button"))
      .find((button) => button.textContent?.trim() === "New Folder in New Section");
    expect(newFolder).toBeDefined();
    await act(async () => {
      newFolder?.click();
    });
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>("#folder-name");
      if (input) setReactInputValue(input, "Subfolder");
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>(".dialog")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await waitFor(() => {
      const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as { folders?: string[] };
      return store.folders?.includes("New Section/Subfolder") ?? false;
    });

    const subfolder = container.querySelector<HTMLElement>('.unified-tree-pane [data-folder-path="New Section/Subfolder"]');
    expect(subfolder).not.toBeNull();

    await act(async () => {
      subfolder?.click();
    });
    await waitFor(() => subfolder?.classList.contains("is-active") ?? false);
    expect(container.querySelector(".note-load-fallback")).toBeNull();

    const createButton = container.querySelector<HTMLButtonElement>(".unified-tree-pane .pane-create-button");
    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
    });
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>(".pane-create-menu button"))
      .map((button) => button.textContent?.trim())).toEqual([
      "New Note in New Section",
      "New Note in Subfolder",
      "New Folder in New Section",
      "New Folder in Subfolder",
    ]);
    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
    });

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => subfolder),
    });
    let dragStartedDuringControlClick = false;
    let controlPointerDefaultPrevented = false;
    await act(async () => {
      const pointerDown = new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 40,
        clientY: 80,
        ctrlKey: true,
      });
      subfolder?.dispatchEvent(pointerDown);
      controlPointerDefaultPrevented = pointerDown.defaultPrevented;
      window.dispatchEvent(pointerEvent("pointermove", 60, 100));
      dragStartedDuringControlClick = document.body.classList.contains("is-dragging-folder");
      window.dispatchEvent(pointerEvent("pointerup", 60, 100));
    });
    expect(controlPointerDefaultPrevented).toBe(true);
    expect(dragStartedDuringControlClick).toBe(false);

    await act(async () => {
      subfolder?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        button: 0,
        clientX: 40,
        clientY: 80,
        ctrlKey: true,
      }));
    });

    const actions = Array.from(container.querySelectorAll<HTMLButtonElement>(".context-menu button"))
      .map((button) => button.textContent?.trim());
    expect(actions).toContain("Rename Folder");
    expect(actions).toContain("Change Folder Icon");
    expect(actions).toContain("Change Folder Color");
    expect(actions).toContain("Delete Folder");
    expect(container.querySelector(".note-load-fallback")).toBeNull();

    await act(async () => root.unmount());
  });

  it("switches directly between section and nested-folder context menus", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: ["Battle Plans", "Battle Plans/Subfolder"],
      notes: {},
    }));
    demoPersistence.set("tigrana-meta:/demo/Tigrana", JSON.stringify({
      revision: 0,
      navigationStyle: "section-view",
      expandedFolders: { "Battle Plans/Subfolder": true },
      welcomeNoteAdded: true,
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });

    const section = Array.from(container.querySelectorAll<HTMLElement>(".section-view-folder-pane [data-folder-path]"))
      .find((element) => element.dataset.folderPath === "Battle Plans");
    expect(section).toBeDefined();
    await act(async () => {
      section?.click();
    });
    await waitFor(() => Array.from(container.querySelectorAll<HTMLElement>(".unified-tree-pane .pane-header strong"))
      .some((element) => element.textContent === "Battle Plans"));
    const subfolder = container.querySelector<HTMLElement>('[data-folder-path="Battle Plans/Subfolder"]');
    expect(subfolder).not.toBeNull();

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("context-menu")) return originalGetBoundingClientRect.call(this);
      const left = Number.parseFloat(this.style.left || "0");
      const width = left > 850 ? 240 : 120;
      return {
        bottom: 320,
        height: 300,
        left,
        right: left + width,
        top: 20,
        width,
        x: left,
        y: 20,
        toJSON: () => ({}),
      };
    });

    for (let index = 0; index < 20; index += 1) {
      const target = index % 2 === 0 ? section : subfolder;
      await act(async () => {
        target?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: index % 2 === 0 ? 20 : 1000,
          clientY: index % 2 === 0 ? 760 : 740,
        }));
      });
    }

    const menu = container.querySelector<HTMLElement>(".context-menu");
    expect(menu).not.toBeNull();
    expect(container.querySelectorAll(".context-menu")).toHaveLength(1);
    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(container.querySelector(".note-load-fallback")).toBeNull();
    expect(Array.from(container.querySelectorAll(".is-context-target")))
      .toEqual([subfolder]);

    await act(async () => root.unmount());
  });

  it("creates the shortcut Note after the active Note in its nested folder", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: ["Meetings", "Meetings/August 2026"],
      notes: {
        "Meetings/Overview.md": "# Overview\n",
        "Meetings/August 2026/Planning.md": "# Planning\n",
        "Meetings/August 2026/Review.md": "# Review\n",
      },
    }));
    demoPersistence.set("tigrana-meta:/demo/Tigrana", JSON.stringify({
      revision: 0,
      navigationStyle: "section-view",
      noteOrder: {
        "Meetings/August 2026": [
          "Meetings/August 2026/Planning.md",
          "Meetings/August 2026/Review.md",
        ],
      },
      welcomeNoteAdded: true,
    }));
    localStorage.setItem("tigrana-session:/demo/Tigrana", JSON.stringify({
      openTabs: ["Meetings/August 2026/Planning.md"],
      activeTab: "Meetings/August 2026/Planning.md",
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });
    await waitFor(() => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note title"]')?.value === "Planning");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "n" }));
    });
    await waitFor(() => {
      const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as { notes?: Record<string, string> };
      return Object.prototype.hasOwnProperty.call(store.notes, "Meetings/August 2026/Untitled.md");
    });
    await waitFor(() => {
      const metadata = JSON.parse(demoPersistence.get("tigrana-meta:/demo/Tigrana") ?? "{}") as {
        noteOrder?: Record<string, string[]>;
      };
      return metadata.noteOrder?.["Meetings/August 2026"]?.[1] === "Meetings/August 2026/Untitled.md";
    });

    const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as { notes?: Record<string, string> };
    expect(store.notes?.["Untitled.md"]).toBeUndefined();
    const metadata = JSON.parse(demoPersistence.get("tigrana-meta:/demo/Tigrana") ?? "{}") as {
      noteOrder?: Record<string, string[]>;
    };
    expect(metadata.noteOrder?.["Meetings/August 2026"]).toEqual([
      "Meetings/August 2026/Planning.md",
      "Meetings/August 2026/Untitled.md",
      "Meetings/August 2026/Review.md",
    ]);

    await act(async () => root.unmount());
  });

  it("moves a root Note before a specific nested Note in one drag", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: ["Meetings", "Meetings/August 2026"],
      notes: {
        "Meetings/Source.md": "# Source\n",
        "Meetings/August 2026/Planning.md": "# Planning\n",
        "Meetings/August 2026/Review.md": "# Review\n",
      },
    }));
    demoPersistence.set("tigrana-meta:/demo/Tigrana", JSON.stringify({
      revision: 0,
      navigationStyle: "section-view",
      expandedFolders: { "Meetings/August 2026": true },
      noteOrder: {
        Meetings: ["Meetings/Source.md"],
        "Meetings/August 2026": [
          "Meetings/August 2026/Planning.md",
          "Meetings/August 2026/Review.md",
        ],
      },
      welcomeNoteAdded: true,
    }));
    localStorage.setItem("tigrana-session:/demo/Tigrana", JSON.stringify({
      openTabs: ["Meetings/Source.md"],
      activeTab: "Meetings/Source.md",
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });

    const source = container.querySelector<HTMLElement>('[data-note-path="Meetings/Source.md"]');
    const target = container.querySelector<HTMLElement>('[data-note-path="Meetings/August 2026/Review.md"]');
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    target!.getBoundingClientRect = () => ({
      bottom: 140,
      height: 40,
      left: 0,
      right: 240,
      top: 100,
      width: 240,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });

    await act(async () => {
      source?.dispatchEvent(pointerEvent("pointerdown", 20, 20));
      window.dispatchEvent(pointerEvent("pointermove", 40, 110));
    });
    expect(target?.classList.contains("is-reorder-before")).toBe(true);

    await act(async () => {
      window.dispatchEvent(pointerEvent("pointerup", 40, 110));
    });
    await waitFor(() => {
      const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as { notes?: Record<string, string> };
      return Boolean(store.notes?.["Meetings/August 2026/Source.md"]);
    });
    await waitFor(() => {
      const metadata = JSON.parse(demoPersistence.get("tigrana-meta:/demo/Tigrana") ?? "{}") as {
        noteOrder?: Record<string, string[]>;
      };
      return metadata.noteOrder?.["Meetings/August 2026"]?.[1] === "Meetings/August 2026/Source.md";
    });

    const metadata = JSON.parse(demoPersistence.get("tigrana-meta:/demo/Tigrana") ?? "{}") as {
      noteOrder?: Record<string, string[]>;
    };
    expect(metadata.noteOrder?.["Meetings/August 2026"]).toEqual([
      "Meetings/August 2026/Planning.md",
      "Meetings/August 2026/Source.md",
      "Meetings/August 2026/Review.md",
    ]);

    await act(async () => root.unmount());
  });

  it("shows a lock beside the neutral dot when the note is read-only", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: [],
      notes: {
        "Welcome.md": "# Welcome\n\nOriginal body.",
      },
    }));
    noteLocks.denied = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const status = container.querySelector(".save-state");
    expect(status?.getAttribute("data-tooltip")).toBe("Read-only");
    expect(status?.hasAttribute("title")).toBe(false);
    expect(status?.classList.contains("is-read-only")).toBe(true);
    expect(status?.children[0]?.classList.contains("save-state-lock")).toBe(true);
    expect(status?.children[1]?.classList.contains("save-state-dot")).toBe(true);

    await act(async () => root.unmount());
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
    expect(container.querySelector(".save-state")?.getAttribute("data-tooltip")).toBe("Unsaved");
    expect(container.querySelector(".save-state")?.classList.contains("is-unsaved")).toBe(true);

    await act(async () => delayedSaves.releases.shift()?.());
    await waitFor(() => delayedSaves.markdown.length === 2);
    await act(async () => delayedSaves.releases.shift()?.());
    await waitFor(() => container.querySelector(".save-state")?.getAttribute("data-tooltip") === "Saved");
    expect(container.querySelector(".save-state")?.classList.contains("is-saved")).toBe(true);

    const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as {
      notes?: Record<string, string>;
    };
    expect(store.notes?.["Welcome.md"]).toContain("Second draft");

    await act(async () => root.unmount());
  });

  it("retries a transient autosave failure without waiting for another edit", async () => {
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

    saveFailures.attempts = 0;
    saveFailures.remaining = 1;
    const body = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Test note body"]');
    await act(async () => {
      if (body) setReactTextareaValue(body, "Recovered autosave body");
    });

    await waitFor(() => saveFailures.attempts === 1);
    expect(container.querySelector(".save-state")?.getAttribute("data-tooltip")).toBe("Unsaved");
    expect(container.querySelector(".save-state")?.classList.contains("is-unsaved")).toBe(true);
    await waitFor(
      () => saveFailures.attempts >= 2
        && container.querySelector(".save-state")?.getAttribute("data-tooltip") === "Saved",
      4_500,
    );
    expect(container.querySelector(".save-state")?.classList.contains("is-saved")).toBe(true);

    const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as {
      notes?: Record<string, string>;
    };
    expect(store.notes?.["Welcome.md"]).toContain("Recovered autosave body");

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

    const newNote = container.querySelector<HTMLButtonElement>(".pane-create-button");
    expect(newNote).not.toBeNull();
    await act(async () => {
      newNote?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".pane-create-menu button")?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const store = JSON.parse(demoPersistence.get("tigrana-demo-v5") ?? "{}") as {
      notes?: Record<string, string>;
    };
    expect(store.notes).toHaveProperty("Untitled.md", "");

    await act(async () => root.unmount());
  });

  it("offers focus mode in the toolbar and editor options, then restores the prior pane layout", async () => {
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
    const markdownButton = container.querySelector<HTMLButtonElement>('button[aria-label="Show raw Markdown"]');
    const editorOptions = container.querySelector<HTMLButtonElement>('button[title="Editor options"]');
    const rightToggle = container.querySelector<HTMLButtonElement>(".outline-toggle");

    expect(findButton?.nextElementSibling).toBe(focusButton);
    expect(focusButton?.nextElementSibling).toBe(markdownButton);
    expect(markdownButton?.nextElementSibling?.contains(editorOptions ?? null)).toBe(true);
    expect(focusButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => editorOptions?.click());
    const focusMenuItem = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'))
      .find((button) => button.textContent?.includes("Enter focus mode"));
    expect(focusMenuItem?.textContent).toContain("Hide navigation and outline");
    expect(focusMenuItem?.getAttribute("aria-checked")).toBe("false");
    await act(async () => focusMenuItem?.click());
    expect(container.querySelector("#left-navigation-panes")).toBeNull();
    expect(container.querySelector("#right-note-sidebar")).toBeNull();
    expect(focusButton?.getAttribute("aria-label")).toBe("Exit focus mode");

    await act(async () => editorOptions?.click());
    const exitFocusMenuItem = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'))
      .find((button) => button.textContent?.includes("Exit focus mode"));
    expect(exitFocusMenuItem?.getAttribute("aria-checked")).toBe("true");
    await act(async () => exitFocusMenuItem?.click());
    expect(container.querySelector("#left-navigation-panes")).not.toBeNull();
    expect(container.querySelector("#right-note-sidebar")).not.toBeNull();

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

  it("offers raw Markdown in both the editor toolbar and editor options", async () => {
    demoPersistence.set("tigrana-demo-v5", JSON.stringify({
      folders: [],
      notes: {
        "Welcome.md": "# Welcome\n\nMarkdown toggle test.",
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

    const markdownButton = container.querySelector<HTMLButtonElement>('button[aria-label="Show raw Markdown"]');
    const editorOptions = container.querySelector<HTMLButtonElement>('button[title="Editor options"]');
    expect(markdownButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => markdownButton?.click());
    expect(container.querySelector('textarea[aria-label="Raw Markdown"]')).not.toBeNull();
    expect(markdownButton?.getAttribute("aria-label")).toBe("Show rich editor");
    expect(markdownButton?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => editorOptions?.click());
    const markdownMenuItem = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'))
      .find((button) => button.textContent?.includes("Show rich editor"));
    expect(markdownMenuItem?.textContent).toContain("Markdown editor style");
    expect(markdownMenuItem?.getAttribute("aria-checked")).toBe("true");
    await act(async () => markdownMenuItem?.click());

    expect(container.querySelector('textarea[aria-label="Raw Markdown"]')).toBeNull();
    expect(container.querySelector('textarea[aria-label="Test note body"]')).not.toBeNull();
    expect(markdownButton?.getAttribute("aria-label")).toBe("Show raw Markdown");
    expect(markdownButton?.getAttribute("aria-pressed")).toBe("false");

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
