// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const scrollIntoView = vi.fn();
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoView,
});
Object.defineProperty(window.Range.prototype, "getClientRects", {
  configurable: true,
  value: () => [],
});
Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => new DOMRect(),
});

vi.mock("../lib/markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/markdown")>();
  return {
    ...actual,
    htmlToMarkdown: vi.fn(actual.htmlToMarkdown),
  };
});

import type { EditorPersistenceHandle } from "./NotesEditor";

const { NotesEditor } = await import("./NotesEditor");
const { htmlToMarkdown, markdownToHtml } = await import("../lib/markdown");

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Note editor typing performance", () => {
  const mounted: Array<{ container: HTMLElement; root: Root }> = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(mounted.splice(0).map(async ({ container, root }) => {
      await act(async () => root.unmount());
      container.remove();
    }));
    vi.mocked(htmlToMarkdown).mockClear();
    scrollIntoView.mockClear();
  });

  it.each([
    "A paragraph with  two spaces and **bold** and *italic*.\n\nNext paragraph.",
    "- [ ] Unfinished task\n- [x] Finished task\n  - nested item",
    "| Name | Value |\n| --- | --- |\n| Cell | **Bold** |",
    "```typescript\nconst code =  1;\n  // keep indentation\n```",
    "> Quoted text\n\n---\n\n![alt](image.png)",
    "# Heading\n\nText with :smile: and `inline code`.",
    '<span style="color: #a83232">Colored **text**</span> and <span style="background-color: #dcecdf">highlight</span>.',

  ])("does not rewrite unchanged rich content at a save boundary: %s", async (content) => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const onChange = vi.fn();
    let handle: EditorPersistenceHandle | null = null;
    await act(async () => {
      root.render(<NotesEditor content={content} commandRequest={null} editable findRequest={0}
        focusAtEndRequest={0} focusRequest={0} historyKey="note-id" notePath="Note.md"
        onChange={onChange} onLoadError={(error) => { throw error; }}
        onPendingChange={() => undefined} onPositionChange={() => undefined}
        onPersistenceReady={(next) => { handle = next; }}
        reloadRequest={0} restorePosition={null} spellcheckEnabled workspace="/Notebook" />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    onChange.mockClear();
    await act(async () => {
      expect(handle!.capture()).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("previews resize locally and persists the final equation size in the full editor", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container); mounted.push({ container, root });
    let handle: EditorPersistenceHandle | null = null;
    await act(async () => root.render(<NotesEditor content={"$$\nx^2\n$$"} editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey="math" notePath="Math.md"
      onChange={() => undefined} onLoadError={error => { throw error; }}
      onPendingChange={() => undefined} onPositionChange={() => undefined}
      onPersistenceReady={next => { handle = next; }} restorePosition={null} spellcheckEnabled workspace="/Notebook" />));
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    vi.mocked(htmlToMarkdown).mockClear();
    const grip = container.querySelector('.equation-resize-handle')!;
    const pointer = (target: EventTarget, type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
      Object.defineProperty(event, "pointerId", { value: 1 }); target.dispatchEvent(event);
    };
    await act(async () => {
      pointer(grip, 'pointerdown', 200);
      for (const x of [180, 160, 140, 120, 104]) pointer(document, 'pointermove', x);
    });
    expect(htmlToMarkdown).not.toHaveBeenCalled();
    expect(handle!.capture()).toBeNull();
    await act(async () => pointer(document, 'pointerup', 104));
    let markdown: string | undefined;
    await act(async () => { markdown = handle!.capture()?.markdown; });
    expect(markdown).toContain(String.raw`{\scriptsize x^2 }`);
    expect(htmlToMarkdown).toHaveBeenCalledTimes(1);
  });

  it("keeps the keyboard-selected slash command in view", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    await act(async () => {
      root.render(
        <NotesEditor
          content=""
          commandRequest={null}
          editable
          findRequest={0}
          focusAtEndRequest={0}
          focusRequest={0}
          historyKey="slash-note-id"
          notePath="Slash.md"
          onChange={() => undefined}
          onLoadError={(error) => {
            throw error;
          }}
          onPendingChange={() => undefined}
          onPositionChange={() => undefined}
          reloadRequest={0}
          restorePosition={null}
          spellcheckEnabled
          workspace="/Notebook"
        />,
      );
    });

    const paragraph = container.querySelector<HTMLElement>(".ProseMirror p");
    await act(async () => {
      if (paragraph) paragraph.textContent = "/";
      paragraph?.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "/",
        inputType: "insertText",
      }));
      await Promise.resolve();
    });

    expect(container.querySelector(".slash-menu")).not.toBeNull();
    scrollIntoView.mockClear();
    const editorElement = container.querySelector<HTMLElement>(".ProseMirror");

    const taskListIndex = Array.from(container.querySelectorAll('.slash-item strong'))
      .findIndex(item => item.textContent === 'Task List');
    expect(taskListIndex).toBeGreaterThan(0);
    for (let index = 0; index < taskListIndex; index += 1) {
      await act(async () => {
        editorElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
      });
    }

    expect(container.querySelector(".slash-item.is-selected strong")?.textContent).toBe("Task List");
    expect(scrollIntoView).toHaveBeenCalledTimes(taskListIndex);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("leaves vertical cursor movement alone when a slash query has no commands", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    await act(async () => {
      root.render(
        <NotesEditor
          content=""
          commandRequest={null}
          editable
          findRequest={0}
          focusAtEndRequest={0}
          focusRequest={0}
          historyKey="slash-list-note-id"
          notePath="Slash list.md"
          onChange={() => undefined}
          onLoadError={(error) => {
            throw error;
          }}
          onPendingChange={() => undefined}
          onPositionChange={() => undefined}
          reloadRequest={0}
          restorePosition={null}
          spellcheckEnabled
          workspace="/Notebook"
        />,
      );
    });

    const paragraph = container.querySelector<HTMLElement>(".ProseMirror p");
    await act(async () => {
      if (paragraph) paragraph.textContent = "/not-a-command";
      paragraph?.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "/not-a-command",
        inputType: "insertText",
      }));
      await Promise.resolve();
    });

    expect(container.querySelector(".slash-menu")).toBeNull();
    const arrowDown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    });
    await act(async () => {
      paragraph?.dispatchEvent(arrowDown);
    });

    expect(arrowDown.defaultPrevented).toBe(false);
  });

  it("does not capture arrow keys after focus leaves an open slash menu", async () => {
    const container = document.createElement("div");
    const rootHost = document.createElement("div");
    const outsideInput = document.createElement("input");
    container.append(rootHost, outsideInput);
    document.body.appendChild(container);
    const root = createRoot(rootHost);
    mounted.push({ container, root });

    await act(async () => {
      root.render(
        <NotesEditor
          content=""
          commandRequest={null}
          editable
          findRequest={0}
          focusAtEndRequest={0}
          focusRequest={0}
          historyKey="slash-focus-note-id"
          notePath="Slash focus.md"
          onChange={() => undefined}
          onLoadError={(error) => {
            throw error;
          }}
          onPendingChange={() => undefined}
          onPositionChange={() => undefined}
          reloadRequest={0}
          restorePosition={null}
          spellcheckEnabled
          workspace="/Notebook"
        />,
      );
    });

    const paragraph = container.querySelector<HTMLElement>(".ProseMirror p");
    await act(async () => {
      if (paragraph) paragraph.textContent = "/";
      paragraph?.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "/",
        inputType: "insertText",
      }));
      await Promise.resolve();
    });

    expect(container.querySelector(".slash-menu")).not.toBeNull();
    outsideInput.focus();
    const arrowDown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    });
    await act(async () => {
      outsideInput.dispatchEvent(arrowDown);
    });

    expect(arrowDown.defaultPrevented).toBe(false);
  });

  it("keeps the find field focused while an arrow button advances and scrolls to a match", async () => {
    const container = document.createElement("div");
    const noteSurface = document.createElement("section");
    noteSurface.className = "note-surface";
    container.appendChild(noteSurface);
    document.body.appendChild(container);
    const root = createRoot(noteSurface);
    mounted.push({ container, root });
    const scrollTo = vi.fn();
    Object.defineProperty(noteSurface, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    const sharedProps = {
      commandRequest: null,
      content: "query first\n\nquery second\n\nquery third",
      editable: true,
      focusAtEndRequest: 0,
      focusRequest: 0,
      historyKey: "find-note-id",
      notePath: "Find.md",
      onChange: () => undefined,
      onLoadError: (error: unknown) => {
        throw error;
      },
      onPendingChange: () => undefined,
      onPositionChange: () => undefined,
      reloadRequest: 0,
      restorePosition: null,
      spellcheckEnabled: true,
      workspace: "/Notebook",
    };

    await act(async () => root.render(<NotesEditor {...sharedProps} findRequest={0} />));
    await act(async () => root.render(<NotesEditor {...sharedProps} findRequest={1} />));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const findInput = container.querySelector<HTMLInputElement>('input[aria-label="Find in current note"]');
    expect(findInput).not.toBeNull();
    await act(async () => {
      if (findInput) setReactInputValue(findInput, "query");
      await Promise.resolve();
    });
    expect(container.querySelector(".find-count")?.textContent).toBe("1/3");

    findInput?.focus();
    const nextButton = container.querySelector<HTMLButtonElement>('button[title="Next match"]');
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => {
      nextButton?.dispatchEvent(mouseDown);
    });
    expect(mouseDown.defaultPrevented).toBe(true);

    await act(async () => {
      nextButton?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });
    expect(container.querySelector(".find-count")?.textContent).toBe("2/3");
    expect(scrollTo).toHaveBeenCalled();
    expect(document.activeElement).toBe(findInput);
  });

  it("does not clear the selected new-note title when the editor loads", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const title = document.createElement("textarea");
    title.value = "Untitled";
    const editorHost = document.createElement("div");
    container.append(title, editorHost);
    document.body.appendChild(container);
    const root = createRoot(editorHost);
    mounted.push({ container, root });
    const renderEditor = (path: string) => (
      <NotesEditor content="" commandRequest={null} editable findRequest={0}
        focusAtEndRequest={0} focusRequest={0} historyKey={path} notePath={path}
        onChange={() => undefined} onLoadError={(error) => { throw error; }}
        onPendingChange={() => undefined} onPositionChange={() => undefined}
        reloadRequest={0} restorePosition={null} spellcheckEnabled workspace="/Notebook" />
    );
    await act(async () => root.render(renderEditor("Previous.md")));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // App focuses the title in a layout effect before the editor's load effect.
    title.focus();
    title.select();
    const clearSelection = vi.spyOn(window.getSelection()!, "removeAllRanges");
    try {
      await act(async () => root.render(renderEditor("Untitled.md")));
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(document.activeElement).toBe(title);
      expect([title.selectionStart, title.selectionEnd]).toEqual([0, title.value.length]);
      // WebKit's textarea highlight must not be cleared by a deferred global blur.
      expect(clearSelection).not.toHaveBeenCalled();
    } finally {
      clearSelection.mockRestore();
    }
  });

  it("keeps the Note viewport pinned while focus moves from a new title to the empty editor", async () => {
    const container = document.createElement("div");
    const noteSurface = document.createElement("section");
    noteSurface.className = "note-surface";
    container.appendChild(noteSurface);
    document.body.appendChild(container);
    const root = createRoot(noteSurface);
    mounted.push({ container, root });

    const renderEditor = (focusRequest: number) => (
      <NotesEditor
        content=""
        commandRequest={null}
        editable
        findRequest={0}
        focusAtEndRequest={0}
        focusRequest={focusRequest}
        historyKey="new-note-id"
        notePath="Untitled.md"
        onChange={() => undefined}
        onLoadError={(error) => {
          throw error;
        }}
        onPendingChange={() => undefined}
        onPositionChange={() => undefined}
        reloadRequest={0}
        restorePosition={null}
        spellcheckEnabled
        workspace="/Notebook"
      />
    );

    await act(async () => root.render(renderEditor(0)));
    const editorElement = container.querySelector<HTMLElement>(".ProseMirror");
    expect(editorElement).not.toBeNull();

    const nativeFocus = HTMLElement.prototype.focus;
    Object.defineProperty(editorElement, "focus", {
      configurable: true,
      value: () => {
        noteSurface.scrollTop = 48;
        nativeFocus.call(editorElement);
      },
    });
    noteSurface.scrollTop = 0;
    const animationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    try {
      await act(async () => root.render(renderEditor(1)));
      expect(noteSurface.scrollTop).toBe(0);
    } finally {
      animationFrame.mockRestore();
    }
  });

  it.each(["notes", "story"] as const)("coalesces a %s typing burst without recreating the editor or rerendering its parent per edit", async (writingStyle) => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    let parentRenderCount = 0;
    const committedMarkdown: string[] = [];

    function Harness() {
      const [content, setContent] = useState("Start");
      parentRenderCount += 1;
      return (
        <NotesEditor
          writingStyle={writingStyle}
          content={content}
          commandRequest={null}
          editable
          findRequest={0}
          focusAtEndRequest={0}
          focusRequest={0}
          historyKey="note-id"
          notePath="Draft.md"
          onChange={(markdown) => {
            committedMarkdown.push(markdown);
            setContent(markdown);
          }}
          onLoadError={(error) => {
            throw error;
          }}
          onPendingChange={() => undefined}
          onPositionChange={() => undefined}
          reloadRequest={0}
          restorePosition={null}
          spellcheckEnabled
          workspace="/Notebook"
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const editorElement = container.querySelector<HTMLElement>(".ProseMirror");
    const paragraph = editorElement?.querySelector("p");
    expect(editorElement).not.toBeNull();
    expect(paragraph).not.toBeNull();
    expect(parentRenderCount).toBe(1);

    for (const text of ["Start a", "Start ab", "Start abc", "Start abcd"]) {
      await act(async () => {
        if (paragraph) paragraph.textContent = text;
        paragraph?.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          data: text.at(-1) ?? null,
          inputType: "insertText",
        }));
        await Promise.resolve();
      });
    }

    expect(parentRenderCount).toBe(1);
    expect(committedMarkdown).toEqual([]);
    expect(htmlToMarkdown).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    expect(committedMarkdown).toEqual(["Start abcd\n"]);
    expect(htmlToMarkdown).toHaveBeenCalledTimes(1);
    expect(parentRenderCount).toBe(2);
    expect(container.querySelector(".ProseMirror")).toBe(editorElement);

    await act(async () => {
      editorElement?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        ctrlKey: true,
        key: "z",
      }));
    });
    expect(container.querySelector(".ProseMirror")?.textContent).toBe("Start");
  });

  it.each(["notes", "story"] as const)("allows ten manual indents and removes them one at a time in %s", async writingStyle => {
    vi.useFakeTimers();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container); mounted.push({ container, root });
    const onChange = vi.fn();
    await act(async () => root.render(
      <NotesEditor content="Opening" writingStyle={writingStyle} editable findRequest={0}
        focusAtEndRequest={0} focusRequest={0} historyKey="tabs" notePath="Tabs.md"
        onChange={onChange} onLoadError={error => { throw error; }} onPendingChange={() => undefined}
        onPositionChange={() => undefined} restorePosition={null} spellcheckEnabled workspace="/Notebook" />
    ));
    const element = container.querySelector(".ProseMirror")!;
    const tab = async (shiftKey = false) => act(async () => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }));
    });
    for (let i = 0; i < 10; i++) await tab();
    expect(element.textContent).toBe("\u2003".repeat(10) + "Opening");
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    expect(onChange).toHaveBeenLastCalledWith(" ".repeat(40) + "Opening\n", "Tabs.md");
    expect(markdownToHtml(onChange.mock.lastCall![0])).toContain("\u2003".repeat(10) + "Opening");
    for (let i = 9; i >= 0; i--) {
      await tab(true);
      expect(element.textContent).toBe("\u2003".repeat(i) + "Opening");
    }
    expect(element.querySelector("p")?.hasAttribute("data-story-indent")).toBe(false);
  });

  it("switches writing styles without reloading the document or losing a pending paragraph override", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container); mounted.push({ container, root });
    const onChange = vi.fn();
    const render = (writingStyle: "notes" | "story", commandRequest: { id: number; command: "paragraphIndent" } | null) => (
      <NotesEditor content="Opening" writingStyle={writingStyle} commandRequest={commandRequest} editable findRequest={0}
        focusAtEndRequest={0} focusRequest={0} historyKey="story-id" notePath="Story.md"
        onChange={onChange} onLoadError={error => { throw error; }} onPendingChange={() => undefined}
        onPositionChange={() => undefined} restorePosition={null} spellcheckEnabled workspace="/Notebook" />
    );
    await act(async () => root.render(render("story", null)));
    const editorElement = container.querySelector(".ProseMirror");
    const command = { id: 1, command: "paragraphIndent" as const };
    await act(async () => root.render(render("story", command)));
    expect(editorElement?.querySelector("p")?.getAttribute("data-story-indent")).toBe("indent");
    await act(async () => root.render(render("notes", command)));
    expect(container.querySelector(".ProseMirror")).toBe(editorElement);
    expect(editorElement?.querySelector("p")?.getAttribute("data-story-indent")).toBe("indent");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("<!-- tigrana:paragraph indent -->\nOpening\n", "Story.md");
    expect(htmlToMarkdown).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending update from the previous Note without recreating the editor", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const onChange = vi.fn();
    const sharedProps = {
      commandRequest: null,
      editable: true,
      findRequest: 0,
      focusAtEndRequest: 0,
      focusRequest: 0,
      onChange,
      onLoadError: (error: unknown) => {
        throw error;
      },
      onPendingChange: () => undefined,
      onPositionChange: () => undefined,
      reloadRequest: 0,
      restorePosition: null,
      spellcheckEnabled: true,
      workspace: "/Notebook",
    };

    await act(async () => {
      root.render(
        <NotesEditor
          {...sharedProps}
          content="Note A"
          historyKey="note-a-id"
          notePath="A.md"
        />,
      );
    });
    const editorElement = container.querySelector<HTMLElement>(".ProseMirror");
    const paragraph = editorElement?.querySelector("p");

    await act(async () => {
      if (paragraph) paragraph.textContent = "Unsaved Note A";
      paragraph?.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "A",
        inputType: "insertText",
      }));
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <NotesEditor
          {...sharedProps}
          content="Note B"
          historyKey="note-b-id"
          notePath="B.md"
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".ProseMirror")).toBe(editorElement);
    expect(container.querySelector(".ProseMirror")?.textContent).toBe("Note B");
  });

  it.each([{ colored: false, writingStyle: "notes" }, { colored: true, writingStyle: "notes" }, { colored: false, writingStyle: "story" }, { colored: true, writingStyle: "story" }] as const)("keeps long-Note typing to one deferred parent update per burst: %j", async ({ colored, writingStyle }) => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const plain = Array.from({ length: 5_000 }, (_, index) => `word${index}`).join(" ");
    const format = (text: string) => colored ? `<span style="color: #a83232">${text}</span>` : text;
    const longNote = format(plain);
    const colorToolbarElement = document.createElement("div");
    container.append(colorToolbarElement);
    let parentRenderCount = 0;
    const committedMarkdown: string[] = [];

    function Harness() {
      const [content, setContent] = useState(longNote);
      parentRenderCount += 1;
      return (
        <NotesEditor
          writingStyle={writingStyle}
          content={content}
          commandRequest={null}
          editable
          findRequest={0}
          focusAtEndRequest={0}
          focusRequest={0}
          colorToolbarElement={colorToolbarElement}
          historyKey="long-note-id"
          notePath="Long.md"
          onChange={(markdown) => {
            committedMarkdown.push(markdown);
            setContent(markdown);
          }}
          onLoadError={(error) => {
            throw error;
          }}
          onPendingChange={() => undefined}
          onPositionChange={() => undefined}
          reloadRequest={0}
          restorePosition={null}
          spellcheckEnabled
          workspace="/Notebook"
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const editorElement = container.querySelector<HTMLElement>(".ProseMirror");
    const paragraph = editorElement?.querySelector("p");

    for (const suffix of [" a", " ab", " abc"]) {
      await act(async () => {
        if (paragraph) {
          // Simulate browser typing inside the active color span.
          if (colored) paragraph.innerHTML = format(plain + suffix);
          else paragraph.textContent = `${plain}${suffix}`;
        }
        paragraph?.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          data: suffix.at(-1) ?? null,
          inputType: "insertText",
        }));
        await Promise.resolve();
      });
    }

    expect(parentRenderCount).toBe(1);
    expect(committedMarkdown).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    expect(committedMarkdown).toHaveLength(1);
    expect(committedMarkdown[0]).toBe(`${format(plain + " abc")}\n`);
    expect(parentRenderCount).toBe(2);
    expect(container.querySelector(".ProseMirror")).toBe(editorElement);
  });

  it("reloads an externally changed Note without recreating the editor or retaining stale Undo history", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const onChange = vi.fn();
    const sharedProps = {
      commandRequest: null,
      editable: true,
      findRequest: 0,
      focusAtEndRequest: 0,
      focusRequest: 0,
      historyKey: "note-id",
      notePath: "Draft.md",
      onChange,
      onLoadError: (error: unknown) => {
        throw error;
      },
      onPendingChange: () => undefined,
      onPositionChange: () => undefined,
      restorePosition: null,
      spellcheckEnabled: true,
      workspace: "/Notebook",
    };

    await act(async () => {
      root.render(<NotesEditor {...sharedProps} content="Original" reloadRequest={0} />);
    });
    const editorElement = container.querySelector<HTMLElement>(".ProseMirror");
    const paragraph = editorElement?.querySelector("p");

    await act(async () => {
      if (paragraph) paragraph.textContent = "Local edit";
      paragraph?.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "t",
        inputType: "insertText",
      }));
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    await act(async () => {
      root.render(<NotesEditor {...sharedProps} content="External edit" reloadRequest={1} />);
    });

    expect(container.querySelector(".ProseMirror")).toBe(editorElement);
    expect(editorElement?.textContent).toBe("External edit");

    await act(async () => {
      editorElement?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        ctrlKey: true,
        key: "z",
      }));
    });
    expect(editorElement?.textContent).toBe("External edit");
  });
});
