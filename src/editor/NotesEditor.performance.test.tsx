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

vi.mock("../lib/notebookStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notebookStorage")>();
  return { ...actual, notebookStorage: { ...actual.notebookStorage,
    saveAsset: vi.fn(async () => "blob:pasted-image"),
  } };
});

import { markdownCommitDelayMs, type EditorCommandRequest, type EditorPersistenceHandle } from "./editorContract";

const { NotesEditor } = await import("./NotesEditor");
const { htmlToMarkdown, markdownToHtml } = await import("../lib/markdown");

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Note editor typing performance", () => {
  it("moves Up Arrow from the first body line into the title", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    const focusTitle = vi.fn();
    await act(async () => root.render(<NotesEditor content="Body" editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey="title-navigation" notePath="Note.md"
      onChange={() => undefined} onLoadError={error => { throw error; }} onPendingChange={() => undefined}
      onPositionChange={() => undefined} onFocusTitle={focusTitle} restorePosition={null}
      spellcheckEnabled workspace="/Notebook" />));
    const editor = (container.querySelector(".ProseMirror") as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    vi.spyOn(editor.view, "endOfTextblock").mockReturnValue(true);
    await act(async () => {
      editor.commands.setTextSelection(3);
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    });
    expect(focusTitle).toHaveBeenCalledOnce();
  });
  it('expands the QUESTION shortcut :? with the complete editor extensions', async () => {
    const { defaultBulletMethodStatuses } = await import('../lib/bulletMethod');
    const statuses = defaultBulletMethodStatuses.map(status => status.id === 'question' ? { ...status, shortcut: ':?' } : status);
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    await act(async () => root.render(<NotesEditor content='' editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey='question-shortcut' notePath='Question.md'
      bulletMethodStatuses={statuses} bulletMethodDisplay={{ enabled: true, replaceBullets: true, dimCompleted: true }}
      onChange={() => undefined} onLoadError={error => { throw error; }} onPendingChange={() => undefined}
      onPositionChange={() => undefined} restorePosition={null} spellcheckEnabled workspace='/Notebook' />));
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
    await act(async () => {
      editor.commands.setTextSelection(1);
      for (const text of ':? ') {
        const { from, to } = editor.state.selection;
        const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to)));
        if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
      }
    });
    expect(editor.state.doc.firstChild?.type.name).toBe('bulletList');
    expect(editor.state.doc.textContent).toBe('QUESTION: ');
  });
  it('returns from a typed footnote on Escape with the complete editor extensions', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    await act(async () => root.render(<NotesEditor content='Body' editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey='footnote-escape' notePath='Footnotes.md'
      onChange={() => undefined} onLoadError={error => { throw error; }} onPendingChange={() => undefined}
      onPositionChange={() => undefined} restorePosition={null} spellcheckEnabled workspace='/Notebook' />));
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
    await act(async () => {
      editor.commands.setTextSelection(5);
      for (const text of '[^]') {
        const { from, to } = editor.state.selection;
        const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to)));
        if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
      }
      editor.commands.insertContent('Footnote text');
    });
    expect(editor.state.selection.$from.node(-1).type.name).toBe('footnoteDefinition');
    await act(async () => {
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(editor.state.selection.from).toBe(6);
    expect(editor.state.selection.empty).toBe(true);
    await act(async () => { editor.commands.insertContent(' continued'); });
    expect(editor.state.doc.firstChild!.textContent).toBe('Body continued');
    expect(editor.state.doc.lastChild!.textContent).toBe('Footnote text');
  });
  const mounted: Array<{ container: HTMLElement; root: Root }> = [];

  it.each([
    ["bulletList", "bulletList"], ["orderedList", "orderedList"],
    ["taskList", "taskList"], ["quote", "blockquote"],
    ["codeBlock", "codeBlock"], ["divider", "horizontalRule"],
  ] as const)("starts %s on a blank line from a menu command", async (command, nodeType) => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    const render = (commandRequest: EditorCommandRequest | null) => <NotesEditor
      content="" commandRequest={commandRequest} editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey="blank-block" notePath="Blank.md"
      onChange={() => undefined} onLoadError={error => { throw error; }} onPendingChange={() => undefined}
      onPositionChange={() => undefined} restorePosition={null} spellcheckEnabled workspace="/Notebook" />;
    await act(async () => root.render(render(null)));
    await act(async () => root.render(render({ id: 1, command })));
    // Tiptap restores DOM focus on the next animation frame.
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    const editor = (container.querySelector(".ProseMirror") as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    expect(editor.state.doc.firstChild?.type.name).toBe(nodeType);
    expect(editor.isFocused).toBe(true);
  });

  // Constructing and serializing this 1,000-footnote DOM can exceed Vitest's
  // five-second default on shared CI runners. Performance is asserted below
  // by conversion/update counts, not by the runner's wall-clock deadline.
  it('persists renumbering on blur after a typing save in a note with 1,000 footnotes', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    const labels = Array.from({ length: 1000 }, (_, index) => 1000 - index);
    const content = labels.map(label => `Reference[^${label}].`).join('\n\n')
      + '\n\n' + labels.map(label => `[^${label}]: Definition ${label}`).join('\n\n');
    const onChange = vi.fn();
    let handle: EditorPersistenceHandle | null = null;
    await act(async () => root.render(<NotesEditor content={content} editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey='footnote-blur' notePath='Footnotes.md'
      onChange={onChange} onLoadError={error => { throw error; }} onPendingChange={() => undefined}
      onPersistenceReady={next => { handle = next; }} onPositionChange={() => undefined}
      restorePosition={null} spellcheckEnabled workspace='/Notebook' />));
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
    const { editFootnote, getMarkdownFootnoteLabels } = await import('./footnotes');
    await act(async () => { editFootnote(editor, '1000'); });
    vi.mocked(htmlToMarkdown).mockClear();
    for (const character of 'Edited ') {
      await act(async () => {
        editor.view.dispatch(editor.state.tr.insertText(character));
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    expect(getMarkdownFootnoteLabels(editor)).toBeUndefined();
    expect(htmlToMarkdown).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { handle!.capture(); });
    expect(htmlToMarkdown).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain('[^1000]: Edited Definition 1000');
    // The typing save is already complete. A label-only blur still needs to
    // schedule another save, without replacing the editor document.
    const doc = editor.state.doc;
    await act(async () => { editor.view.dom.dispatchEvent(new FocusEvent('blur')); });
    expect(editor.state.doc).toBe(doc);
    expect(htmlToMarkdown).toHaveBeenCalledTimes(1);
    await act(async () => { handle!.capture(); });
    expect(htmlToMarkdown).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(2);
    const saved = onChange.mock.calls[1][0] as string;
    expect(saved).toContain('[^1]: Edited Definition 1000');
    expect(saved).toContain('[^1000]: Definition 1');
    expect(saved.match(/^\[\^\d+\]:/gm)).toHaveLength(1000);
    await act(async () => { editor.view.dom.dispatchEvent(new FocusEvent('blur')); handle!.capture(); });
    expect(htmlToMarkdown).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("publishes numbered footnotes once and keeps sidebar targets correct across pending edits and cached Note switches", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    let markdown = 'First[^1]. Second[^2].\n\n[^1]: First\n\n[^2]: Second';
    let handle: EditorPersistenceHandle | null = null;
    const onChange = vi.fn((next: string) => { markdown = next; });
    const render = (path = 'A.md', commandRequest: EditorCommandRequest | null = null) => <NotesEditor
      content={path === 'A.md' ? markdown : 'Other note'} commandRequest={commandRequest}
      editable findRequest={0} focusAtEndRequest={0} focusRequest={0} historyKey={path} notePath={path}
      onChange={onChange} onLoadError={error => { throw error; }} onPendingChange={() => undefined}
      onPersistenceReady={next => { handle = next; }} onPositionChange={() => undefined}
      restorePosition={null} spellcheckEnabled workspace="/Notebook" />;
    await act(async () => root.render(render()));
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
    const setContent = vi.spyOn(editor.commands, 'setContent');
    vi.mocked(htmlToMarkdown).mockClear();
    await act(async () => { editor.commands.setTextSelection(1); });
    await act(async () => root.render(render('A.md', { id: 1, command: 'footnote' })));
    // Before the deferred publication, the sidebar still calls the old second
    // footnote "2". The newly computed numbering must not change that target.
    await act(async () => root.render(render('A.md', { id: 2, command: 'footnote', src: '2' })));
    expect(editor.state.selection.$from.node(-1).textContent).toBe('Second');
    expect(htmlToMarkdown).not.toHaveBeenCalled();
    await act(async () => { handle!.capture(); });
    expect(htmlToMarkdown).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(markdown.trim()).toBe('[^1]First[^2]. Second[^3].\n\n[^1]: \n\n[^2]: First\n\n[^3]: Second');
    await act(async () => root.render(render('A.md', { id: 3, command: 'footnote', src: '2' })));
    expect(editor.state.selection.$from.node(-1).textContent).toBe('First');
    expect(setContent).not.toHaveBeenCalled();
    await act(async () => root.render(render('A.md', { id: 4, command: 'deleteFootnote', src: '2' })));
    await act(async () => { handle!.capture(); });
    expect(markdown).toContain('[^2]: Second');
    expect(markdown).not.toContain('[^2]: First');
    await act(async () => root.render(render('B.md')));
    await act(async () => root.render(render()));
    await act(async () => root.render(render('A.md', { id: 5, command: 'footnote', src: '1' })));
    // A cached state retains the original internal label and its undo history.
    expect(editor.state.selection.$from.node(-1).attrs.label).toBe('3');
    await act(async () => { editor.commands.undo(); handle!.capture(); });
    expect(markdown).toContain('[^2]: First');
    expect(markdown).toContain('[^3]: Second');
  });

  it("opens /date with the keyboard and dismisses it on an identical-content Note switch", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    const render = (path: string, content = "/date") => <NotesEditor content={content} editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey={path} notePath={path}
      onChange={() => undefined} onLoadError={error => { throw error; }}
      onPendingChange={() => undefined} onPositionChange={() => undefined}
      restorePosition={null} spellcheckEnabled workspace="/Notebook" />;
    await act(async () => root.render(render("A.md", "")));
    const pm = container.querySelector<HTMLElement>(".ProseMirror")!;
    const editor = (pm as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    await act(async () => { editor.commands.insertContent("/date"); });
    await act(async () => { pm.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(document.querySelector('[role="dialog"][aria-label="Insert date"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-current")).toBe("date");
    await act(async () => root.render(render("B.md")));
    expect(document.querySelector('[role="dialog"][aria-label="Insert date"]')).toBeNull();
    expect(editor.getText()).toBe("/date");
  });

  it("keeps current Bullet Statuses settings after fresh loads, cached switches, and reloads", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    const display = { enabled: true, replaceBullets: true, dimCompleted: true };
    const off = { ...display, enabled: false };
    const render = (path: string, settings = display, reloadRequest = 0) => <NotesEditor
      content={"- DONE: Finished\n- TODO: Work"} bulletMethodDisplay={settings}
      commandRequest={null} editable findRequest={0} focusAtEndRequest={0} focusRequest={0}
      historyKey={path} notePath={path} onChange={() => undefined} onLoadError={error => { throw error; }}
      onPendingChange={() => undefined} onPositionChange={() => undefined} reloadRequest={reloadRequest}
      restorePosition={null} spellcheckEnabled workspace="/Notebook" />;
    const count = () => container.querySelectorAll('.bullet-method-marker-button').length;
    await act(async () => root.render(render('A.md', off)));
    await act(async () => root.render(render('A.md')));
    expect(count()).toBe(2);
    await act(async () => root.render(render('B.md')));
    expect(count()).toBe(2);
    await act(async () => root.render(render('A.md')));
    expect(count()).toBe(2);
    await act(async () => root.render(render('A.md', off)));
    await act(async () => root.render(render('B.md', off)));
    expect(count()).toBe(0);
    await act(async () => root.render(render('B.md')));
    await act(async () => root.render(render('A.md')));
    expect(count()).toBe(2);
    await act(async () => root.render(render('A.md', display, 1)));
    expect(count()).toBe(2);
  });

  it("allows native selection to start in the blank space below the last line", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container); mounted.push({ container, root });
    const onChange = vi.fn();
    await act(async () => root.render(<NotesEditor content={"DONE: Yo\n\nTODO: Testing\n\nSomething else"} editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey="selection" notePath="Selection.md"
      onChange={onChange} onLoadError={error => { throw error; }}
      onPendingChange={() => undefined} onPositionChange={() => undefined}
      restorePosition={null} spellcheckEnabled workspace="/Notebook" />));
    const pm = container.querySelector<HTMLElement>(".ProseMirror")!;
    const editor = (pm as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    // jsdom has no layout hit-testing. A press below the final block maps
    // to the end of the document in the browser.
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: editor.state.doc.content.size - 1, inside: -1 });
    vi.spyOn(pm.lastElementChild!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 80, 300, 20));
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 200 });
    await act(async () => { pm.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(false);
    await act(async () => { pm.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 50, clientY: 200 })); });
    expect(onChange).not.toHaveBeenCalled();
  });

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
    await act(async () => { await vi.advanceTimersByTimeAsync(markdownCommitDelayMs); });
    onChange.mockClear();
    await act(async () => {
      expect(handle!.capture()).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("outlines images inside text ranges without showing resize handles", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    await act(async () => root.render(<NotesEditor content={"Above.\n\n![First](first.png)\n\nBelow.\n\n- ![Second](second.png)\n\nEnd."} editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey="range-images" notePath="Images.md"
      onChange={() => undefined} onLoadError={error => { throw error; }}
      onPendingChange={() => undefined} onPositionChange={() => undefined}
      restorePosition={null} spellcheckEnabled workspace="/Notebook" />));
    const pm = container.querySelector<HTMLElement>(".ProseMirror")!;
    const editor = (pm as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    const imagePositions: number[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "image") imagePositions.push(pos); });
    for (const reverse of [false, true]) {
      const from = 1, to = imagePositions[1] + 1;
      await act(async () => { editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to }); });
      expect(container.querySelectorAll(".image-range-selected")).toHaveLength(2);
      expect(container.querySelector(".image-resize-handle")).toBeNull();
    }
    await act(async () => { editor.commands.setTextSelection({ from: 1, to: imagePositions[0] }); });
    expect(container.querySelector(".image-range-selected")).toBeNull();
    await act(async () => { editor.commands.setTextSelection({ from: 1, to: imagePositions[0] + 1 }); });
    expect(container.querySelectorAll(".image-range-selected")).toHaveLength(1);
    await act(async () => { editor.commands.setNodeSelection(imagePositions[0]); });
    expect(container.querySelector(".image-range-selected")).toBeNull();
    expect(container.querySelectorAll(".image-resize-handle")).toHaveLength(2);
    await act(async () => { editor.commands.setTextSelection(1); });
    expect(container.querySelector(".image-range-selected")).toBeNull();
    expect(container.querySelector(".image-resize-handle")).toBeNull();
  });

  it.each(["![Image](image.png)", "- ![Image](image.png)", "paste", "paste-middle", "paste-edit"])("keeps image selection, text stats, and resize stable: %s", async imageMarkdown => {
    vi.useFakeTimers();
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    const onPositionChange = vi.fn();
    await act(async () => root.render(<NotesEditor content={`Some note text.\n\n${imageMarkdown.startsWith("paste") ? "" : imageMarkdown}`} editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey="images" notePath="Images.md"
      onChange={() => undefined} onLoadError={error => { throw error; }}
      onPendingChange={() => undefined} onPositionChange={onPositionChange}
      restorePosition={null} spellcheckEnabled workspace="/Notebook" />));
    const pm = container.querySelector<HTMLElement>(".ProseMirror")!;
    const editor = (pm as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    await act(async () => { await vi.advanceTimersByTimeAsync(markdownCommitDelayMs); });
    if (imageMarkdown.startsWith("paste")) {
      await act(async () => { editor.commands.setTextSelection(imageMarkdown === "paste-middle" ? 6 : editor.state.doc.content.size - 1); });
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: {
        files: [new File(["image"], "Pasted image.png", { type: "image/png" })],
        getData: () => "",
      } });
      await act(async () => { pm.dispatchEvent(paste); });
      expect(paste.defaultPrevented).toBe(true);
      if (imageMarkdown === "paste-edit") {
        await act(async () => { editor.commands.insertContentAt(1, "Caption: "); });
      }
    }
    let imagePos = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "image") imagePos = pos; });
    const img = container.querySelector(".image-resizable img")!;
    const clickImage = () => {
      img.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      img.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    await act(async () => { editor.commands.setTextSelection(1); clickImage(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    expect(editor.state.selection.from).toBe(imagePos);
    expect(onPositionChange.mock.lastCall?.[0].selectedText).toBe("");
    expect(container.querySelector(".image-resizable.is-selected")).not.toBeNull();
    await act(async () => { clickImage(); });
    expect(container.querySelector(".image-resize-edge")).not.toBeNull();
    expect(container.querySelector(".image-resize-handle.is-top")).not.toBeNull();
    if (imageMarkdown.startsWith("-")) expect(img.closest("li")).not.toBeNull();
    vi.spyOn(img.parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 3000));
    const edge = container.querySelector(".image-resize-edge")!;
    const pointer = (target: EventTarget, type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
      Object.defineProperty(event, "pointerId", { value: 1 }); target.dispatchEvent(event);
    };
    vi.mocked(htmlToMarkdown).mockClear();
    await act(async () => {
      pointer(edge, "pointerdown", 400);
      pointer(document, "pointermove", 300);
    });
    expect(htmlToMarkdown).not.toHaveBeenCalled();
    expect(editor.state.doc.nodeAt(imagePos)?.attrs.width).toBeNull();
    await act(async () => pointer(document, "pointerup", 250));
    expect(editor.state.doc.nodeAt(imagePos)?.attrs.width).toBe(250);
    const serialized = htmlToMarkdown(editor.getHTML());
    expect(serialized).toContain('width="250"');
    await act(async () => editor.commands.setContent(markdownToHtml(serialized)));
    expect(container.querySelector(".image-resizable")?.getAttribute("style")).toContain("250px");
    if (imageMarkdown.startsWith("-")) expect(container.querySelector("li .image-resizable")).not.toBeNull();

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
    await act(async () => { await vi.advanceTimersByTimeAsync(markdownCommitDelayMs); });
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
      await vi.advanceTimersByTimeAsync(markdownCommitDelayMs);
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

  it.each([false, true])("indents selected bullets ending at the following paragraph, reverse: %s", async reverse => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); mounted.push({ container, root });
    await act(async () => root.render(<NotesEditor content={"- Parent\n- Second\n- Third\n\nAfter"} writingStyle="notes" editable findRequest={0}
      focusAtEndRequest={0} focusRequest={0} historyKey="list-tabs" notePath="Tabs.md"
      onChange={() => undefined} onLoadError={error => { throw error; }} onPendingChange={() => undefined}
      onPositionChange={() => undefined} restorePosition={null} spellcheckEnabled workspace="/Notebook" />));
    const editor = (container.querySelector(".ProseMirror") as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    const list = editor.state.doc.firstChild!;
    const from = 3 + list.firstChild!.nodeSize;
    const to = list.nodeSize + 1;
    await act(async () => {
      editor.commands.setTextSelection(reverse ? { from: to, to: from } : { from, to });
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(editor.state.doc.textContent).toBe("ParentSecondThirdAfter");
    const parent = editor.state.doc.firstChild!.firstChild!;
    expect(parent.childCount).toBe(2);
    expect(parent.lastChild!.type.name).toBe("bulletList");
    expect(parent.lastChild!.textContent).toBe("SecondThird");
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
    await act(async () => { await vi.advanceTimersByTimeAsync(markdownCommitDelayMs); });
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
    await act(async () => { await vi.advanceTimersByTimeAsync(markdownCommitDelayMs); });
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
      await vi.advanceTimersByTimeAsync(markdownCommitDelayMs);
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
    const footnotes = colored ? "\n\nReference[^test].\n\n[^test]: Preserved footnote." : "";
    const longNote = format(plain) + footnotes;
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
      await vi.advanceTimersByTimeAsync(markdownCommitDelayMs);
    });

    expect(committedMarkdown).toHaveLength(1);
    expect(committedMarkdown[0]).toBe(`${format(plain + " abc")}${footnotes}\n`);
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
      await vi.advanceTimersByTimeAsync(markdownCommitDelayMs);
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
