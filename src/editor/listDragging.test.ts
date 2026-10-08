// @vitest-environment jsdom
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { ListDragging, moveListItem } from "./listDragging";
import { ListFolding, listFoldingKey } from "./listFolding";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { createBulletMoveHighlightPlugin } from "./bulletMoveHighlight";

const MovementFeedback = Extension.create({
  name: 'movementFeedback',
  addProseMirrorPlugins: () => [createBulletMoveHighlightPlugin()],
});

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function make(content: string) {
  const surface = document.createElement("div"); surface.className = "note-surface";
  const element = document.createElement("div"); surface.append(element); document.body.append(surface);
  const editor = new Editor({ element, extensions: [StarterKit.configure({ trailingNode: false }), ListFolding, ListDragging, MovementFeedback], content, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); editor.view.dispatch(editor.state.tr);
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 20, left: 0, right: 0 });
  return editor;
}
function position(editor: Editor, text: string, type = "listItem") {
  let result = -1;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === type && node.firstChild?.textContent === text) result = pos; });
  return result;
}
function target(editor: Editor, text: string, after = false) {
  const pos = position(editor, text);
  return { pos: pos + (after ? editor.state.doc.nodeAt(pos)!.nodeSize : 0), listPos: editor.state.doc.resolve(pos).before() };
}
function move(editor: Editor, text: string, drop: Parameters<typeof moveListItem>[2]) {
  const tr = moveListItem(editor.state, position(editor, text), drop);
  expect(tr).not.toBeNull(); editor.view.dispatch(tr!);
}
const nested = '<ul><li><p>Parent</p><ul><li><p>Child</p><ul><li><p>Grandchild</p></li></ul></li></ul></li><li><p>Sibling</p></li><li><p>Last</p></li></ul>';

it("moves a parent and every descendant in both directions with one undo, preserving Markdown", () => {
  const editor = make(nested);
  const before = editor.getJSON();
  move(editor, "Parent", target(editor, "Last", true));
  expect(editor.state.doc.firstChild!.child(2).textContent).toBe("ParentChildGrandchild");
  expect(editor.state.selection.$from.parent.textContent).toBe("Parent");
  expect(editor.getHTML()).not.toContain("list-drag");
  const saved = htmlToMarkdown(editor.getHTML());
  expect(saved).toContain("- Parent\n  - Child\n    - Grandchild");
  const loaded = make(markdownToHtml(saved));
  expect(loaded.state.doc.firstChild!.child(2).textContent).toBe("ParentChildGrandchild");
  editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  editor.commands.redo();
  move(editor, "Parent", target(editor, "Sibling"));
  expect(editor.state.doc.firstChild!.firstChild!.textContent).toBe("ParentChildGrandchild");
});

it("rejects the source, its descendants, same-place drops, and invalid containers", () => {
  const editor = make(nested); const before = editor.getJSON();
  for (const drop of [target(editor, "Parent"), target(editor, "Parent", true), target(editor, "Child"), target(editor, "Grandchild", true), { pos: 3 }, { pos: -1 }, { pos: 0, listPos: 0 }]) {
    expect(moveListItem(editor.state, position(editor, "Parent"), drop)).toBeNull();
  }
  expect(editor.getJSON()).toEqual(before);
});

it("moves across lists and nesting levels, pruning a last-child nested list", () => {
  const editor = make(nested + '<p>Between</p><ol><li><p>Numbered</p></li></ol>');
  move(editor, "Child", target(editor, "Numbered", true));
  expect(editor.state.doc.firstChild!.firstChild!.childCount).toBe(1);
  expect(editor.state.doc.child(2).lastChild!.textContent).toBe("ChildGrandchild");
  move(editor, "Sibling", target(editor, "Grandchild"));
  expect(editor.state.doc.child(2).lastChild!.lastChild!.firstChild!.textContent).toBe("Sibling");
});

it.each([false, true])("creates a new list around a moved item outside lists (last source item: %s)", only => {
  const editor = make('<p>Before</p><ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li>' + (only ? '' : '<li><p>Sibling</p></li>') + '</ul><p>After</p>');
  move(editor, "Parent", { pos: editor.state.doc.content.size });
  expect(editor.state.doc.lastChild!.type.name).toBe("bulletList");
  expect(editor.state.doc.lastChild!.textContent).toBe("ParentChild");
  expect(editor.state.doc.child(only ? 1 : 2).textContent).toBe("After");
  expect(editor.getHTML()).not.toContain('<li><p></p></li>');
});

it("keeps folded descendants folded during a move", () => {
  const editor = make(nested);
  editor.view.dom.querySelectorAll<HTMLButtonElement>(".list-fold-button")[1].click();
  editor.view.dom.querySelector<HTMLButtonElement>(".list-fold-button")!.click();
  move(editor, "Parent", target(editor, "Last", true));
  expect(listFoldingKey.getState(editor.state)?.collapsedCount).toBe(2);
});

function rect(element: Element, x: number, y: number, width: number, height: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, width, height));
}
function pointer(element: EventTarget, type: string, x: number, y: number, id = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: id }); element.dispatchEvent(event); return event;
}
function geometry(editor: Editor) {
  rect(editor.view.dom, 100, 50, 600, 650); rect(editor.view.dom.closest('.note-surface')!, 50, 0, 700, 800);
  const items = [...editor.view.dom.querySelectorAll('li')];
  items.forEach((li, i) => {
    let depth = 0;
    for (let parent = li.parentElement?.closest('li'); parent; parent = parent.parentElement?.closest('li')) depth++;
    const left = 140 + depth * 24;
    rect(li, left, 80 + i * 30, 700 - left, (li.querySelectorAll('li').length + 1) * 30);
    rect(li.querySelector(':scope > p')!, left + 2, 80 + i * 30, 698 - left, 30);
  });
  editor.view.dom.querySelectorAll('ul, ol').forEach(list => {
    const children = [...list.children].filter(child => child.tagName === 'LI');
    const first = children[0]?.getBoundingClientRect(), last = children.at(-1)?.getBoundingClientRect();
    if (first && last) rect(list, first.left - 24, first.top, 724 - first.left, last.bottom - first.top);
  });
}
function handle(editor: Editor) {
  const p = editor.view.dom.querySelector('li > p')!; pointer(p, 'pointermove', 200, 90);
  return document.querySelector<HTMLButtonElement>('.list-drag-handle')!;
}

it.each([0, 1, 2])("scrolls the note from the floating grip with wheel delta mode %s", deltaMode => {
  const editor = make(nested); geometry(editor);
  editor.view.dom.style.lineHeight = '30px';
  const surface = editor.view.dom.closest<HTMLElement>('.note-surface')!;
  Object.defineProperty(surface, 'clientHeight', { value: 400 });
  Object.defineProperty(surface, 'clientWidth', { value: 700 });
  const grip = handle(editor), onUpdate = vi.fn(); editor.on('update', onUpdate);
  const event = new WheelEvent('wheel', { deltaY: 2, deltaX: 1, deltaMode, bubbles: true, cancelable: true });
  grip.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(surface.scrollTop).toBe([2, 60, 800][deltaMode]);
  expect(surface.scrollLeft).toBe([1, 30, 700][deltaMode]);
  // A second wheel event from the same gesture still reaches the note after
  // scrolling hides the grip. Scrolling never changes or saves the document.
  surface.dispatchEvent(new Event('scroll', { bubbles: false }));
  expect(grip.hidden).toBe(true);
  grip.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, deltaMode, cancelable: true }));
  expect(surface.scrollTop).toBe([1, 30, 400][deltaMode]);
  expect(onUpdate).not.toHaveBeenCalled();
});

it("leaves wheel zoom gestures and ordinary gutter scrolling to the browser", () => {
  const editor = make(nested); geometry(editor);
  const grip = handle(editor), surface = editor.view.dom.closest<HTMLElement>('.note-surface')!;
  const zoom = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true });
  grip.dispatchEvent(zoom);
  expect(zoom.defaultPrevented).toBe(false); expect(surface.scrollTop).toBe(0);
  const gutter = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  surface.dispatchEvent(gutter);
  expect(gutter.defaultPrevented).toBe(false); expect(surface.scrollTop).toBe(0);
  editor.destroy(); editors.splice(editors.indexOf(editor), 1);
  const detached = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
  grip.dispatchEvent(detached);
  expect(detached.defaultPrevented).toBe(false); expect(surface.scrollTop).toBe(0);
});

it("reveals the grip by entering the empty gutter before ever hovering text", () => {
  const editor = make(nested); geometry(editor);
  pointer(editor.view.dom.closest('.note-surface')!, 'pointermove', 80, 90);
  expect(document.querySelector<HTMLButtonElement>('.list-drag-handle')!.hidden).toBe(false);
});

it("keeps only the grip's own bullet marked for fold-caret visibility and clears it on exit", async () => {
  const editor = make(nested); geometry(editor);
  const items = [...editor.view.dom.querySelectorAll('li')];
  const folds = items.map(item => item.querySelector(':scope > .list-fold-button'));
  const surface = editor.view.dom.closest('.note-surface')!;
  const grip = document.querySelector<HTMLButtonElement>('.list-drag-handle')!;
  const onUpdate = vi.fn(); editor.on('update', onUpdate);
  pointer(surface, 'pointermove', 80, 90);
  pointer(grip, 'pointermove', 80, 90);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([...editor.view.dom.querySelectorAll('.is-list-drag-hovered')]).toEqual([folds[0]]);
  expect(editor.view.dom.querySelector('li')).toBe(items[0]);
  pointer(surface, 'pointermove', 104, 120);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([...editor.view.dom.querySelectorAll('.is-list-drag-hovered')]).toEqual([folds[1]]);
  pointer(document.body, 'pointermove', 0, 0);
  expect(editor.view.dom.querySelector('.is-list-drag-hovered')).toBeNull();
  expect(grip.hidden).toBe(true);
  pointer(surface, 'pointermove', 80, 90);
  editor.setEditable(false, false);
  expect(editor.view.dom.querySelector('.is-list-drag-hovered')).toBeNull();
  expect(editor.getHTML()).not.toContain('is-list-drag-hovered');
  expect(onUpdate).not.toHaveBeenCalled();
});

it("reveals the same first-line grip while hovering a wrapped continuation line", () => {
  const editor = make('<ul><li><p>Wrapped bullet</p></li><li><p>Second</p></li></ul>'); geometry(editor);
  const li = editor.view.dom.querySelector('li')!;
  rect(li, 140, 80, 560, 60); rect(li.querySelector('p')!, 142, 80, 558, 60);
  pointer(li.querySelector('p')!, 'pointermove', 200, 125);
  const grip = document.querySelector<HTMLButtonElement>('.list-drag-handle')!;
  expect(grip.hidden).toBe(false);
  expect(parseFloat(grip.style.top)).toBeLessThan(100);
});

it("reveals nested grips directly and keeps them visible after clicking without dragging", () => {
  const editor = make(nested); geometry(editor);
  pointer(editor.view.dom.closest('.note-surface')!, 'pointermove', 132, 150);
  const grip = document.querySelector<HTMLButtonElement>('.list-drag-handle')!;
  expect(grip.hidden).toBe(false);
  expect(parseFloat(grip.style.left)).toBeCloseTo(125.5);
  pointer(grip, 'pointerdown', 132, 150); pointer(document, 'pointerup', 132, 150);
  expect(grip.hidden).toBe(false);
  expect(editor.state.doc.textContent).toBe('ParentChildGrandchildSiblingLast');
});

it("bounds row measurements when entering the gutter of a thousand-item note", () => {
  const editor = make('<ul>' + Array.from({ length: 1000 }, (_, index) => `<li><p>Item ${index}</p></li>`).join('') + '</ul>');
  geometry(editor);
  const reads = [...editor.view.dom.querySelectorAll('li')].map(li => vi.mocked(li.getBoundingClientRect));
  reads.forEach(read => read.mockClear());
  pointer(editor.view.dom.closest('.note-surface')!, 'pointermove', 80, 90);
  expect(document.querySelector<HTMLButtonElement>('.list-drag-handle')!.hidden).toBe(false);
  expect(reads.reduce((sum, read) => sum + read.mock.calls.length, 0)).toBeLessThan(25);
});

it("tracks nearby row boundaries and nesting while dragging vertically in the outer gutter", () => {
  const editor = make(nested); geometry(editor);
  const paragraphs = editor.view.dom.querySelectorAll('li > p');
  pointer(paragraphs[4], 'pointermove', 200, 212);
  const grip = document.querySelector<HTMLButtonElement>('.list-drag-handle')!;
  vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: position(editor, 'Parent') + 2, inside: position(editor, 'Parent') });
  pointer(grip, 'pointerdown', 80, 212);
  const indicator = document.querySelector<HTMLElement>('.list-drag-indicator')!;
  for (const [y, top, left] of [[178, 170, 140], [158, 170, 188], [122, 110, 164], [92, 80, 140]]) {
    pointer(document, 'pointermove', 80, y);
    expect(indicator.hidden).toBe(false);
    expect(parseFloat(indicator.style.top)).toBe(top);
    expect(parseFloat(indicator.style.left)).toBe(left);
  }
  pointer(document, 'pointerup', 80, 122);
  expect(editor.state.doc.firstChild!.firstChild!.lastChild!.firstChild!.textContent).toBe('Last');
});

it("shows immediate nearby feedback for an unchanged drop without editing the note", () => {
  const editor = make(nested); geometry(editor);
  pointer(editor.view.dom.closest('.note-surface')!, 'pointermove', 80, 212);
  const grip = document.querySelector<HTMLButtonElement>('.list-drag-handle')!;
  const before = editor.getJSON(), onUpdate = vi.fn(); editor.on('update', onUpdate);
  pointer(grip, 'pointerdown', 80, 212); pointer(document, 'pointermove', 80, 206);
  const line = document.querySelector<HTMLElement>('.list-drag-indicator')!;
  expect(line.hidden).toBe(false); expect(parseFloat(line.style.top)).toBe(200);
  pointer(document, 'pointerup', 80, 206);
  expect(editor.getJSON()).toEqual(before); expect(onUpdate).not.toHaveBeenCalled();
  expect(editor.view.dom.querySelector('.bullet-method-moved')).toBeNull();
});

it("uses pointer movement with a threshold, a drop line, and exactly one document update", () => {
  const editor = make('<ul><li><p>One</p></li><li><p>Two</p></li></ul>'); geometry(editor);
  const grip = handle(editor); expect(grip.hidden).toBe(false); expect(grip.draggable).toBe(false);
  const onUpdate = vi.fn(); editor.on('update', onUpdate);
  expect(pointer(grip, 'pointerdown', 100, 90).defaultPrevented).toBe(true);
  pointer(document, 'pointermove', 102, 91); expect(document.body.classList.contains('is-dragging-list-item')).toBe(false);
  pointer(document, 'pointermove', 200, 137);
  expect(document.body.classList.contains('is-dragging-list-item')).toBe(true);
  expect(document.querySelector<HTMLElement>('.list-drag-indicator')!.hidden).toBe(false);
  expect(editor.state.doc.textContent).toBe('OneTwo'); expect(onUpdate).not.toHaveBeenCalled();
  const native = new Event('dragstart', { bubbles: true, cancelable: true }); grip.dispatchEvent(native); expect(native.defaultPrevented).toBe(true);
  pointer(document, 'pointerup', 200, 137);
  expect(editor.state.doc.textContent).toBe('TwoOne'); expect(onUpdate).toHaveBeenCalledOnce();
  expect(editor.view.dom.querySelector('.bullet-method-moved')?.textContent).toBe('One');
  expect(document.body.classList.contains('is-dragging-list-item')).toBe(false);
  expect(document.querySelector<HTMLElement>('.list-drag-indicator')!.hidden).toBe(true);
  editor.commands.undo(); expect(editor.state.doc.textContent).toBe('OneTwo');
  expect(editor.view.dom.querySelector('.bullet-method-moved')).toBeNull();
});

it.each([false, true])("fades only the moved bullet's own paragraph without saving feedback (new list: %s)", newList => {
  vi.useFakeTimers();
  try {
    const editor = make(nested + '<p>After</p>');
    const onUpdate = vi.fn(); editor.on('update', onUpdate);
    move(editor, 'Parent', newList ? { pos: editor.state.doc.content.size } : target(editor, 'Last', true));
    const cue = editor.view.dom.querySelector('.bullet-method-moved');
    expect(cue?.tagName).toBe('P'); expect(cue?.textContent).toBe('Parent');
    expect(editor.view.dom.querySelectorAll('.bullet-method-moved')).toHaveLength(1);
    expect(editor.getHTML()).not.toContain('bullet-method-moved');
    expect(htmlToMarkdown(editor.getHTML())).not.toContain('bullet-method-moved');
    vi.advanceTimersByTime(850);
    expect(editor.view.dom.querySelector('.bullet-method-moved')).not.toBeNull();
    vi.advanceTimersByTime(50);
    expect(editor.view.dom.querySelector('.bullet-method-moved')).toBeNull();
    expect(onUpdate).toHaveBeenCalledOnce();
    editor.commands.undo(); expect(editor.state.doc.firstChild!.firstChild!.textContent).toBe('ParentChildGrandchild');
  } finally { vi.useRealTimers(); }
});

it.each(['pointercancel', 'escape', 'blur', 'reload', 'readonly', 'destroy'])("cancels safely on %s", reason => {
  const editor = make(nested); geometry(editor); const grip = handle(editor);
  pointer(grip, 'pointerdown', 100, 90); pointer(document, 'pointermove', 200, 217);
  const before = editor.getJSON();
  if (reason === 'pointercancel') pointer(document, 'pointercancel', 200, 217);
  if (reason === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  if (reason === 'blur') window.dispatchEvent(new Event('blur'));
  if (reason === 'reload') editor.commands.setContent('<p>Another note</p>');
  if (reason === 'readonly') editor.setEditable(false);
  if (reason === 'destroy') { editors.splice(editors.indexOf(editor), 1); editor.destroy(); }
  pointer(document, 'pointerup', 200, 217);
  expect(document.body.classList.contains('is-dragging-list-item')).toBe(false);
  expect(document.querySelector('.bullet-method-moved')).toBeNull();
  if (reason === 'reload') expect(editor.state.doc.textContent).toBe('Another note');
  else if (reason !== 'destroy') expect(editor.getJSON()).toEqual(before);
});

it("keeps the gutter reachable and does no document work while typing", () => {
  const editor = make(nested); geometry(editor); const grip = handle(editor);
  rect(grip, 70, 80, 20, 22);
  pointer(editor.view.dom.querySelector('ul')!, 'pointermove', 95, 90); expect(grip.hidden).toBe(false);
  pointer(editor.view.dom.querySelector('li > p')!, 'pointermove', 200, 112); expect(grip.hidden).toBe(false);
  const walk = vi.spyOn(editor.state.doc, 'descendants');
  const between = vi.spyOn(editor.state.doc, 'nodesBetween');
  editor.commands.setTextSelection(4); editor.commands.insertContent('x');
  expect(walk).not.toHaveBeenCalled();
  // ListFolding already bounds its changed-range traversal; dragging adds none.
  expect(between.mock.calls.every(([from, to]) => to - from < 10)).toBe(true);
  editor.setEditable(false); pointer(editor.view.dom.querySelector('li > p')!, 'pointermove', 200, 90); expect(grip.hidden).toBe(true);
});

it("keeps a nested grip reachable across its ancestor's gutter", () => {
  const editor = make(nested); geometry(editor);
  const paragraphs = editor.view.dom.querySelectorAll('li > p');
  pointer(paragraphs[1], 'pointermove', 200, 120);
  const grip = document.querySelector<HTMLButtonElement>('.list-drag-handle')!;
  rect(grip, 70, 110, 20, 22);
  pointer(editor.view.dom.querySelector('li')!, 'pointermove', 108, 120);
  expect(grip.hidden).toBe(false);
  pointer(grip, 'pointerdown', 80, 120); pointer(document, 'pointermove', 200, 217); pointer(document, 'pointerup', 200, 217);
  expect(editor.state.doc.firstChild!.lastChild!.textContent).toBe('ChildGrandchild');
  expect(editor.state.doc.firstChild!.firstChild!.textContent).toBe('Parent');
});

it("follows React's editor reparenting so the outer gutter remains reachable", () => {
  const editor = new Editor({ extensions: [StarterKit, ListDragging], content: nested }); editors.push(editor);
  const surface = document.createElement('div'); surface.className = 'note-surface'; document.body.append(surface);
  surface.append(editor.view.dom); editor.view.setProps({}); geometry(editor);
  const grip = handle(editor); rect(grip, 70, 80, 20, 22);
  editor.view.dom.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: surface }));
  pointer(surface, 'pointermove', 95, 90);
  expect(grip.hidden).toBe(false);
});

it.each([false, true])("reveals the grip after reparenting without a transaction (previous pane: %s)", previousPane => {
  const editor = previousPane ? make(nested) : new Editor({ extensions: [StarterKit, ListDragging], content: nested });
  if (!previousPane) editors.push(editor);
  const surface = document.createElement('div'); surface.className = 'note-surface'; document.body.append(surface);
  surface.append(editor.view.dom); geometry(editor);
  pointer(surface, 'pointermove', 80, 90);
  const grip = document.querySelector<HTMLButtonElement>('.list-drag-handle')!;
  expect(grip.hidden).toBe(false);
  pointer(grip, 'pointerdown', 80, 90); pointer(document, 'pointermove', 80, 218); pointer(document, 'pointerup', 80, 218);
  expect(editor.state.doc.firstChild!.lastChild!.textContent).toBe('ParentChildGrandchild');
});

it("never offers or commits a pointer drop in its own descendants", () => {
  const editor = make(nested); geometry(editor); const grip = handle(editor); const before = editor.getJSON();
  pointer(grip, 'pointerdown', 80, 90); pointer(document, 'pointermove', 200, 147);
  expect(document.querySelector<HTMLElement>('.list-drag-indicator')!.hidden).toBe(true);
  pointer(document, 'pointerup', 200, 147); expect(editor.getJSON()).toEqual(before);
});

it.each([false, true])("uses one indicator for both sides of a sibling gap (nested: %s)", nestedList => {
  const list = '<ul><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ul>';
  const editor = make(nestedList ? `<ul><li><p>Parent</p>${list}</li></ul>` : list); geometry(editor);
  const base = nestedList ? 110 : 80;
  const items = [...editor.view.dom.querySelectorAll('li')].filter(li => li.querySelector(':scope > p')?.textContent !== 'Parent');
  items.forEach((li, index) => {
    const left = nestedList ? 164 : 140;
    rect(li, left, base + index * 30, 700 - left, 26);
    rect(li.querySelector('p')!, left + 2, base + index * 30, 698 - left, 26);
  });
  pointer(items[0].querySelector('p')!, 'pointermove', 200, base + 10);
  const grip = document.querySelector<HTMLButtonElement>('.list-drag-handle')!;
  pointer(grip, 'pointerdown', 100, base + 10);
  const indicator = document.querySelector<HTMLElement>('.list-drag-indicator')!;
  let previousStyle: string | undefined;
  for (const y of [base + 54, base + 58, base + 62, base + 54]) {
    pointer(document, 'pointermove', 100, y);
    expect(indicator.hidden).toBe(false);
    expect(parseFloat(indicator.style.top)).toBe(base + 58);
    if (previousStyle) expect(indicator.style.cssText).toBe(previousStyle);
    previousStyle = indicator.style.cssText;
  }
  pointer(document, 'pointerup', 100, base + 62);
  expect(editor.state.doc.firstChild!.textContent).toBe(nestedList ? 'ParentTwoOneThree' : 'TwoOneThree');
  expect(editor.state.doc.childCount).toBe(1);
});

it("auto-scrolls while held at an edge and stops on cancellation", () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { callbacks.push(cb); return callbacks.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const editor = make(nested); geometry(editor); const grip = handle(editor);
  pointer(grip, 'pointerdown', 80, 90); pointer(document, 'pointermove', 200, 780);
  const surface = editor.view.dom.closest<HTMLElement>('.note-surface')!;
  callbacks[0](0); expect(surface.scrollTop).toBe(12);
  pointer(document, 'pointercancel', 200, 780); expect(cancelAnimationFrame).toHaveBeenCalled();
});

it("positions the floating grip and indicator in viewport coordinates at app zoom", () => {
  const editor = make('<ul><li><p>One</p></li><li><p>Two</p></li></ul>'); geometry(editor);
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const style = computed(element);
    if (element === document.documentElement) vi.spyOn(style, 'getPropertyValue').mockReturnValue('1.25');
    return style;
  });
  const grip = handle(editor);
  // Fallback font is 17px; geometry is in viewport pixels, style uses CSS pixels.
  expect(parseFloat(grip.style.left)).toBeCloseTo((140 - (17 * 2.5 + 20) * 1.25) / 1.25);
  pointer(grip, 'pointerdown', 80, 90); pointer(document, 'pointermove', 200, 137);
  const indicator = document.querySelector<HTMLElement>('.list-drag-indicator')!;
  expect(parseFloat(indicator.style.left)).toBe(140 / 1.25);
  expect(parseFloat(indicator.style.width)).toBe(560 / 1.25);
  pointer(document, 'pointercancel', 200, 137);
});
