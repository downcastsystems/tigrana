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

const { NotesEditor } = await import("./NotesEditor");
const { htmlToMarkdown } = await import("../lib/markdown");

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

    for (let index = 0; index < 9; index += 1) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });
    }

    expect(container.querySelector(".slash-item.is-selected strong")?.textContent).toBe("Task List");
    expect(scrollIntoView).toHaveBeenCalledTimes(9);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("coalesces a typing burst without recreating the editor or rerendering its parent per edit", async () => {
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

  it("keeps long-Note typing to one deferred parent update per burst", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const longNote = Array.from({ length: 5_000 }, (_, index) => `word${index}`).join(" ");
    let parentRenderCount = 0;
    const committedMarkdown: string[] = [];

    function Harness() {
      const [content, setContent] = useState(longNote);
      parentRenderCount += 1;
      return (
        <NotesEditor
          content={content}
          commandRequest={null}
          editable
          findRequest={0}
          focusAtEndRequest={0}
          focusRequest={0}
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
        if (paragraph) paragraph.textContent = `${longNote}${suffix}`;
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
    expect(committedMarkdown[0]).toBe(`${longNote} abc\n`);
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
