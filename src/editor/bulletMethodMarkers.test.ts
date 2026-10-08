// @vitest-environment jsdom
import { Editor, type Extensions } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { afterEach, expect, it, vi } from "vitest";
import { BulletMethodMarkers, bulletMethodMarkersKey } from "./bulletMethodMarkers";
import { defaultBulletMethodStatuses } from "../lib/bulletMethod";
import { sortSelectedLines } from "./sortLines";
import { TextColor, ColorHighlight } from "./inlineColorMarks";
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });
function make(content: string, extraExtensions: Extensions = []) {
  const editor = new Editor({ editorProps: { handleScrollToSelection: () => true }, extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), BulletMethodMarkers, ...extraExtensions], content });
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, replaceBullets: true, dimCompleted: true }));
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 20, bottom: 40, left: 20, right: 20 });
  editors.push(editor);
  return editor;
}
const markers = (editor: Editor) => [...editor.view.dom.querySelectorAll('li')].map(li => li.getAttribute('data-bullet-method-marker'));

it("updates click and Shift-click destinations when the shared order or Cycle choices change", () => {
  const editor = make('<ul><li><p>TODO: Task</p></li></ul>');
  const statuses = [...defaultBulletMethodStatuses].reverse().map(s => ({ ...s, cycle: s.id !== 'question' }));
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  const button = () => editor.view.dom.querySelector<HTMLButtonElement>('button')!;
  expect(button().getAttribute('aria-label')).toBe('TODO: change to CLOSED');
  button().click();
  expect(editor.state.doc.textContent).toBe('CLOSED: Task');
  button().dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  expect(editor.state.doc.textContent).toBe('TODO: Task');
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses.map(s => ({ ...s, cycle: false }))));
  button().click();
  expect(editor.state.doc.textContent).toBe('TODO: Task');
});

it("renders only the direct status of ordinary bullets, without changing saved HTML or document attributes", () => {
  const html = '<ul><li><p>CLOSED: Delegated</p></li><li><p><strong>done:</strong> Finished</p></li><li><p>TODO: Start</p><ul><li><p>Plain child</p></li><li><p>IN PROGRESS: Nested</p></li></ul></li><li><p>Plain parent</p><ul><li><p>TODO: Child</p></li></ul></li></ul><ol><li><p>DONE: Numbered</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>TODO: Checkbox</p></li></ul>';
  const editor = make(html);
  expect(markers(editor)).toEqual(['slash', 'check', 'circle', null, 'dot', null, 'circle', null, null]);
  expect(editor.getHTML()).not.toContain('data-bullet-method-marker');
  expect(JSON.stringify(editor.getJSON())).not.toContain('marker');
});

it("updates the affected bullet while typing, deleting, and undoing a prefix", () => {
  const editor = make('<ul><li><p>TODO</p></li><li><p>Plain</p></li></ul>');
  editor.commands.setTextSelection(7);
  editor.commands.insertContent(':');
  expect(markers(editor)).toEqual(['circle', null]);
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.commands.deleteRange({ from: 3, to: 8 });
  expect(markers(editor)).toEqual([null, null]);
  editor.commands.undo();
  expect(markers(editor)).toEqual(['circle', null]);
  editor.commands.undo();
  expect(markers(editor)).toEqual([null, null]);
});

it("follows renamed built-in identities and restores ordinary bullets when a status is removed", () => {
  const editor = make('<ul><li><p>WAITING: Work</p></li><li><p>TODO: Old</p></li><li><p>CUSTOM: Other</p></li></ul>');
  const statuses = defaultBulletMethodStatuses.map(status => status.id === 'todo' ? { ...status, prefix: 'WAITING' } : status);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, [...statuses, { id: 'custom', prefix: 'CUSTOM', description: '' }]));
  expect(markers(editor)).toEqual(['circle', null, null]);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses.filter(status => status.id !== 'todo')));
  expect(markers(editor)).toEqual([null, null, null]);
});

it("keeps markers with their status after sorting, indenting, and changing list type", () => {
  const editor = make('<ul><li><p>TODO: Work</p></li><li><p>DONE: Finished</p></li></ul>');
  editor.commands.setTextSelection({ from: 3, to: editor.state.doc.firstChild!.nodeSize - 3 });
  editor.view.dispatch(sortSelectedLines(editor.state, 'sort_bullet_method')!);
  expect(markers(editor)).toEqual(['check', 'circle']);
  editor.commands.toggleOrderedList();
  expect(markers(editor)).toEqual([null, null]);
  editor.commands.toggleBulletList();
  expect(markers(editor)).toEqual(['check', 'circle']);
  const pos = 3 + editor.state.doc.firstChild!.firstChild!.nodeSize;
  editor.commands.setTextSelection(pos);
  editor.commands.sinkListItem('listItem');
  expect(markers(editor)).toEqual(['check', 'circle']);
});

it("does not scan unrelated items or rebuild decorations for selection changes", () => {
  const editor = make('<ul>' + Array.from({ length: 1000 }, (_, i) => `<li><p>TODO: <strong>Item ${i}</strong></p></li>`).join('') + '</ul>');
  const before = bulletMethodMarkersKey.getState(editor.state);
  editor.commands.setTextSelection(8);
  expect(bulletMethodMarkersKey.getState(editor.state)).toBe(before);
  const unrelated = editor.state.doc.firstChild!.child(500).firstChild!;
  const read = vi.spyOn(unrelated, 'textBetween');
  const visitBold = vi.spyOn(unrelated, 'forEach');
  editor.commands.insertContent('x');
  expect(read).not.toHaveBeenCalled();
  expect(visitBold).not.toHaveBeenCalled();
  expect(markers(editor)).toHaveLength(1000);
});

it("cycles prefixes with isolated undo while preserving formatted body and nested notes", () => {
  const editor = make('<ul><li><p>TODO: <strong>Keep this</strong></p><ul><li><p>TODO: Child</p></li></ul></li></ul>');
  const click = () => editor.view.dom.querySelector<HTMLButtonElement>('.bullet-method-marker-button')!.click();
  for (const prefix of ['IN PROGRESS', 'DONE', 'CLOSED', 'QUESTION', 'TODO']) {
    click();
    expect(editor.state.doc.firstChild!.firstChild!.firstChild!.textContent).toBe(prefix + ': Keep this');
    expect(editor.getHTML()).toContain('<strong>Keep this</strong>');
    expect(editor.getHTML()).toContain('TODO: Child');
    expect(editor.getHTML()).not.toContain('button');
  }
  editor.commands.undo();
  expect(editor.state.doc.firstChild!.firstChild!.firstChild!.textContent).toBe('QUESTION: Keep this');
  editor.commands.redo();
  expect(editor.state.doc.firstChild!.firstChild!.firstChild!.textContent).toBe('TODO: Keep this');
  editor.setEditable(false);
  click();
  expect(editor.state.doc.firstChild!.firstChild!.firstChild!.textContent).toBe('TODO: Keep this');
});

it("uses saved circle choices and skips removed statuses when cycling renamed statuses", () => {
  const editor = make('<ul><li><p>WAITING: Work</p></li></ul>');
  const statuses = defaultBulletMethodStatuses.filter(status => status.id !== 'in-progress').map(status => status.id === 'todo' ? { ...status, prefix: 'WAITING', icon: 'dashed' as const } : status);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  expect(markers(editor)).toEqual(['dashed']);
  editor.view.dom.querySelector<HTMLButtonElement>('button')!.click();
  expect(markers(editor)).toEqual(['check']);
  expect(editor.state.doc.textContent).toBe('DONE: Work');
});

it("bolds the full cycled label and colon, preserving body marks, colors, and isolated undo", () => {
  const editor = make('<ul><li><p><em><span style="color: #ff0000">TODO</span></em>: Plain <strong>Bold</strong></p><ul><li><p>Child</p></li></ul></li></ul>', [TextColor]);
  const before = editor.getHTML();
  editor.view.dom.querySelector<HTMLButtonElement>('.bullet-method-marker-button')!.click();
  const paragraph = editor.state.doc.firstChild!.firstChild!.firstChild!;
  expect(paragraph.firstChild!.text).toBe('IN PROGRESS');
  expect(paragraph.firstChild!.marks.map(mark => mark.type.name)).toEqual(['bold', 'italic', 'textColor']);
  expect(paragraph.child(1).text).toBe(':');
  expect(paragraph.child(1).marks.map(mark => mark.type.name)).toEqual(['bold']);
  expect(paragraph.child(2).text).toBe(' Plain ');
  expect(paragraph.child(2).marks).toEqual([]);
  expect(editor.getHTML()).toContain('<strong>Bold</strong>');
  expect(editor.state.selection.$from.marks().some(mark => mark.type.name === 'bold')).toBe(false);
  editor.commands.undo();
  expect(editor.getHTML()).toBe(before);
});

it("honors live status bolding choices without rewriting existing formatting", () => {
  const editor = make('<ul><li><p>TODO: Plain</p></li></ul>');
  const display = { enabled: true, replaceBullets: true, dimCompleted: true, autoSortOnClick: false };
  const click = () => editor.view.dom.querySelector<HTMLButtonElement>('.bullet-method-marker-button')!.click();
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { ...display, autoBoldStatus: false }));
  click();
  expect(editor.getHTML()).not.toContain('<strong>');
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { ...display, autoBoldStatus: true }));
  expect(editor.getHTML()).not.toContain('<strong>');
  click();
  expect(editor.getHTML()).toContain('<strong>DONE:</strong> Plain');
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { ...display, autoBoldStatus: false }));
  click();
  expect(editor.getHTML()).toContain('<strong>CLOSED:</strong> Plain');
});

it("does not carry generated status bolding into typing after a label-only bullet", () => {
  const editor = make('<ul><li><p>TODO:</p></li></ul>');
  editor.view.dom.querySelector<HTMLButtonElement>('.bullet-method-marker-button')!.click();
  editor.commands.insertContent(' Body');
  expect(editor.getHTML()).toContain('<strong>IN PROGRESS:</strong> Body');
});

it("dims completed paragraphs independently of icons without modifying nested statuses or saved content", () => {
  const editor = make('<ul><li><p>DONE: Parent</p><ul><li><p>TODO: Child</p></li></ul></li><li><p>CLOSED: Finished</p></li></ul>');
  const dimmed = () => [...editor.view.dom.querySelectorAll('[data-bullet-method-dim]')].map(node => node.textContent);
  expect(dimmed()).toEqual(['DONE: Parent', 'CLOSED: Finished']);
  expect(editor.view.dom.querySelectorAll('li[data-bullet-method-completed]')).toHaveLength(2);
  expect(editor.getHTML()).not.toContain('data-bullet-method-dim');
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: false, dimCompleted: true }));
  expect(editor.view.dom.querySelector('button')).toBeNull();
  expect(markers(editor)).toEqual([null, null, null]);
  expect(dimmed()).toEqual(['DONE: Parent', 'CLOSED: Finished']);
  expect(editor.view.dom.querySelectorAll('li[data-bullet-method-completed]')).toHaveLength(2);
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, dimCompleted: false }));
  expect(dimmed()).toEqual([]);
  expect(editor.view.dom.querySelectorAll('li[data-bullet-method-completed]')).toHaveLength(0);
  expect(markers(editor)).toEqual(['check', 'circle', 'slash']);
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, dimCompleted: true }));
  editor.view.dom.querySelector<HTMLButtonElement>('button')!.click();
  expect(dimmed()).toEqual(['CLOSED: Parent', 'CLOSED: Finished']);
  editor.view.dom.querySelector<HTMLButtonElement>('button')!.click();
  expect(dimmed()).toEqual(['CLOSED: Finished']);
});

it("composites uncolored bold runs without dimming explicit colors or highlights, or persisting wrappers", () => {
  const editor = make('<ul><li><p>DONE: <strong>Plain <span style="color: #ff0000">Red</span> After <mark>Highlight</mark></strong></p><ul><li><p>TODO: <strong>Child</strong> <a href="https://example.com"><strong>Link</strong></a></p></li></ul></li><li><p>TODO: <strong>Active</strong></p></li></ul>', [TextColor, ColorHighlight]);
  const saved = editor.getHTML();
  const runs = () => [...editor.view.dom.querySelectorAll('.bullet-method-dim-bold')].map(node => node.textContent);
  expect(runs()).toEqual(['Plain ', ' After ', 'Child', 'Link', 'Active']);
  expect(editor.view.dom.querySelector('[data-text-color] .bullet-method-dim-bold, mark .bullet-method-dim-bold')).toBeNull();
  expect(editor.view.dom.querySelector('.bullet-method-dim-bold .bullet-method-dim-bold')).toBeNull();
  expect(saved).not.toContain('bullet-method-dim-bold');
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: false, dimCompleted: false }));
  expect(runs()).toEqual([]);
  expect(editor.getHTML()).toBe(saved);
});

it("keeps bold fade ranges current through typing, partial formatting, colors, and undo", () => {
  const editor = make('<ul><li><p>DONE: <strong>Alpha Bravo</strong></p><ul><li><p>Child <strong>Charlie</strong></p></li></ul></li></ul>', [TextColor, ColorHighlight]);
  const ranges = () => bulletMethodMarkersKey.getState(editor.state)!.decorations.find().filter(d => d.spec.dimBold).map(d => [d.from, d.to]);
  const check = () => {
    const incremental = ranges();
    editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, dimCompleted: true }));
    expect(incremental).toEqual(ranges());
    expect(editor.view.dom.querySelector('.bullet-method-dim-bold .bullet-method-dim-bold')).toBeNull();
  };
  const select = (text: string) => editor.commands.setTextSelection({ from: textPosition(editor, text), to: textPosition(editor, text) + text.length });
  select('Bravo'); editor.commands.toggleBold(); check();
  editor.commands.insertContent('Beta'); check();
  select('Alpha'); editor.commands.setMark('textColor', { color: '#ff0000' }); check();
  editor.commands.unsetMark('textColor'); check();
  select('Charlie'); editor.commands.setHighlight(); check();
  editor.commands.undo(); check();
  select('DONE'); editor.commands.insertContent('TODO'); check();
  expect(editor.view.dom.querySelector('[data-bullet-method-completed]')).toBeNull();
  expect(editor.getHTML()).not.toContain('bullet-method-dim-bold');
});

it("recognizes COMPLETE as a completed parent without inventing a status icon", () => {
  const editor = make('<ul><li><p>COMPLETE: Parent</p><ul><li><p>Nested note</p></li></ul></li></ul>');
  expect(editor.view.dom.querySelectorAll('li[data-bullet-method-completed]')).toHaveLength(1);
  expect(editor.view.dom.querySelector('button')).toBeNull();
  expect(editor.getHTML()).not.toContain('data-bullet-method-completed');
});

it("defaults off and removes all appearance decorations when disabled", () => {
  const editor = new Editor({ editorProps: { handleScrollToSelection: () => true }, extensions: [StarterKit, BulletMethodMarkers], content: '<ul><li><p>DONE: Task</p></li></ul>' });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 20, bottom: 40, left: 20, right: 20 });
  editors.push(editor);
  expect(editor.view.dom.querySelector('[data-bullet-method-completed],button')).toBeNull();
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, dimCompleted: true }));
  expect(editor.view.dom.querySelector('button')).not.toBeNull();
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: false, replaceBullets: true, dimCompleted: true }));
  expect(editor.view.dom.querySelector('[data-bullet-method-completed],button')).toBeNull();
});

it("dims configured statuses but ignores legacy dimming for unmarked and unknown items", () => {
  const editor = make('<ul><li><p>DONE: Keep bright</p></li><li><p>WAITING: Dim me</p><ul><li><p>Nested note</p></li></ul></li><li><p>Custom: Dim me too</p></li><li><p>Unmarked</p></li><li><p>UNKNOWN: Keep bright</p></li></ul>');
  const statuses = [...defaultBulletMethodStatuses.map(status => status.id === 'done' ? { ...status, dim: false } : status.id === 'todo' ? { ...status, prefix: 'WAITING', dim: true } : status), { id: 'custom', prefix: 'Custom', description: '', dim: true }];
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  const dimmed = () => [...editor.view.dom.querySelectorAll('p[data-bullet-method-dim]')].map(node => node.textContent);
  expect(dimmed()).toEqual(['WAITING: Dim me', 'Custom: Dim me too']);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses.map(status => status.prefix === null ? { ...status, dim: true } : status)));
  expect(dimmed()).toEqual(['WAITING: Dim me', 'Custom: Dim me too']);
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, dimCompleted: false }));
  expect(dimmed()).toEqual([]);
  expect(editor.getHTML()).not.toContain('data-bullet-method-dim');
});

function textPosition(editor: Editor, text: string) {
  let found = 0;
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text); });
  return found;
}
const itemTexts = (editor: Editor) => Array.from(editor.view.dom.querySelectorAll("li > p"), p => p.textContent);
it("sorts on click, moves the caret into the clicked item, and undoes both changes together", () => {
  const editor = make('<ul><li><p>TODO: First</p></li><li><p>TODO: Second</p></li><li><p>CLOSED: Third</p></li></ul>');
  editor.commands.setTextSelection(textPosition(editor, "Second") + 3);
  editor.view.dom.querySelector<HTMLButtonElement>('button')!.click();
  expect(itemTexts(editor)).toEqual(["CLOSED: Third", "IN PROGRESS: First", "TODO: Second"]);
  expect(editor.state.selection.head).toBe(textPosition(editor, "First"));
  editor.commands.undo();
  expect(itemTexts(editor)).toEqual(["TODO: First", "TODO: Second", "CLOSED: Third"]);
  editor.commands.redo();
  expect(itemTexts(editor)).toEqual(["CLOSED: Third", "IN PROGRESS: First", "TODO: Second"]);
});
it("moves an off-screen caret to the clicked item after sorting", () => {
  const editor = make('<ul><li><p>TODO: First</p></li><li><p>TODO: Second</p></li></ul>');
  editor.commands.setTextSelection(textPosition(editor, "Second") + 2);
  vi.mocked(editor.view.coordsAtPos).mockReturnValue({ top: -40, bottom: -20, left: 20, right: 20 });
  editor.view.dom.querySelector<HTMLButtonElement>('button')!.click();
  expect(editor.state.selection.head).toBe(textPosition(editor, "First"));
  expect(itemTexts(editor)).toEqual(["IN PROGRESS: First", "TODO: Second"]);
});
it("uses the live auto-sort switch and never sorts just because a status was typed", () => {
  const editor = make('<ul><li><p>TODO: First</p></li><li><p>TODO: Second</p></li></ul>');
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, autoSortOnClick: false }));
  editor.view.dom.querySelector<HTMLButtonElement>('button')!.click();
  expect(itemTexts(editor)).toEqual(["IN PROGRESS: First", "TODO: Second"]);
  expect(editor.state.selection.head).toBe(textPosition(editor, "First"));
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true }));
  editor.commands.insertContentAt({ from: 3, to: 14 }, "DONE");
  expect(itemTexts(editor)).toEqual(["DONE: First", "TODO: Second"]);
});

it("follows custom status order and moves a visible outside caret into the clicked item", () => {
  const editor = make('<p>Outside text</p><ul><li><p>TODO: First</p><ul><li><p>DONE: Child</p></li></ul></li><li><p>DONE: Second</p></li></ul>');
  const statuses = [...defaultBulletMethodStatuses].reverse();
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  const cursor = textPosition(editor, "Outside") + 4;
  editor.commands.setTextSelection(cursor);
  editor.view.dom.querySelector<HTMLButtonElement>('button')!.click();
  expect(itemTexts(editor)).toEqual(["QUESTION: First", "DONE: Child", "DONE: Second"]);
  expect(editor.state.selection.head).toBe(textPosition(editor, "First"));
});

it("highlights the moved item and restarts the expiry for rapid status clicks", () => {
  const editor = make('<ul><li><p>IN PROGRESS: Middle</p></li><li><p>TODO: First</p></li><li><p>TODO: Second</p></li><li><p>CLOSED: Third</p></li></ul>');
  vi.useFakeTimers();
  try {
    const clickFirst = () => {
      const item = [...editor.view.dom.querySelectorAll('li')].find(li => li.textContent?.includes('First'))!;
      item.querySelector<HTMLButtonElement>('button')!.click();
    };
    clickFirst();
    const initialClass = editor.view.dom.querySelector('.bullet-method-moved')!.className;
    expect(editor.view.dom.querySelector('.bullet-method-moved')?.textContent).toBe('IN PROGRESS: First');
    vi.advanceTimersByTime(400);
    clickFirst();
    expect(editor.view.dom.querySelectorAll('.bullet-method-moved')).toHaveLength(1);
    expect(editor.view.dom.querySelector('.bullet-method-moved')?.textContent).toBe('DONE: First');
    expect(editor.view.dom.querySelector('.bullet-method-moved')!.className).not.toBe(initialClass);
    vi.advanceTimersByTime(200);
    expect(editor.view.dom.querySelector('.bullet-method-moved')?.textContent).toBe('DONE: First');
    expect(editor.getHTML()).not.toContain('bullet-method-moved');
    vi.advanceTimersByTime(700);
    expect(editor.view.dom.querySelector('.bullet-method-moved')).toBeNull();
    editor.commands.undo();
    expect(itemTexts(editor)).toEqual(['CLOSED: Third', 'IN PROGRESS: Middle', 'IN PROGRESS: First', 'TODO: Second']);
  } finally { vi.useRealTimers(); }
});

it("clears movement feedback on undo and does not highlight an item that stays in place", () => {
  const editor = make('<ul><li><p>TODO: Second</p></li><li><p>TODO: First</p></li></ul>');
  editor.view.dom.querySelectorAll<HTMLButtonElement>('button')[1]!.click();
  expect(editor.view.dom.querySelector('.bullet-method-moved')).not.toBeNull();
  editor.commands.undo();
  expect(editor.view.dom.querySelector('.bullet-method-moved')).toBeNull();
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, autoSortOnClick: false }));
  editor.view.dom.querySelectorAll<HTMLButtonElement>('button')[1]!.click();
  expect(editor.view.dom.querySelector('.bullet-method-moved')).toBeNull();
});

it("anchors repeated pointer clicks to the same bullet without smooth scrolling", () => {
  const editor = make('<ul><li><p>IN PROGRESS: Middle</p></li><li><p>TODO: First</p></li><li><p>TODO: Second</p></li><li><p>CLOSED: Third</p></li></ul>');
  const surface = document.createElement('div');
  surface.className = 'note-surface';
  surface.style.scrollBehavior = 'smooth';
  surface.append(editor.view.dom);
  document.body.append(surface);
  surface.scrollTop = 200;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = this.classList.contains('bullet-method-marker-button')
      ? [...editor.view.dom.querySelectorAll('.bullet-method-marker-button')].indexOf(this) : -1;
    const top = index < 0 ? 0 : 400 + index * 120 - surface.scrollTop;
    return { top, bottom: top + (index < 0 ? 600 : 20), left: 20, right: 40, width: 20, height: index < 0 ? 600 : 20, x: 20, y: top, toJSON() {} };
  });
  const firstButton = () => [...editor.view.dom.querySelectorAll('li')].find(li => li.textContent?.includes('First'))!.querySelector<HTMLButtonElement>('button')!;
  try {
    const originalTop = firstButton().getBoundingClientRect().top;
    firstButton().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(surface.scrollTop).toBe(320);
    expect(firstButton().getBoundingClientRect().top).toBe(originalTop);
    firstButton().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    expect(surface.scrollTop).toBe(200);
    expect(firstButton().getBoundingClientRect().top).toBe(originalTop);
    expect(firstButton().closest('li')?.textContent).toContain('DONE: First');
    expect(surface.style.scrollBehavior).toBe('smooth');
  } finally { surface.remove(); }
});

it.each([false, true])("celebrates DONE once after a status click (auto-sort: %s), then cleans up", autoSortOnClick => {
  vi.useFakeTimers();
  const editor = make('<ul><li><p>IN PROGRESS: Finish this</p></li><li><p>TODO: Other</p></li></ul>');
  document.body.append(editor.view.dom);
  try {
    editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, autoSortOnClick }));
    editor.view.dom.querySelector<HTMLButtonElement>('button')!.click();
    vi.advanceTimersByTime(20);
    expect(document.querySelectorAll('.bullet-status-celebration > i')).toHaveLength(12);
    expect(editor.getHTML()).not.toContain('celebration');
    vi.advanceTimersByTime(650);
    expect(document.querySelector('.bullet-status-celebration')).toBeNull();
    editor.commands.undo();
    editor.commands.redo();
    vi.advanceTimersByTime(20);
    expect(document.querySelector('.bullet-status-celebration')).toBeNull();
  } finally { editor.view.dom.remove(); vi.useRealTimers(); }
});

it("honors disabled celebrations, custom names, reduced motion and editor cleanup", () => {
  vi.useFakeTimers();
  const editor = make('<ul><li><p>IN PROGRESS: Finish this</p></li></ul>');
  const editorDOM = editor.view.dom;
  document.body.append(editorDOM);
  const click = () => { editor.view.dom.querySelector<HTMLButtonElement>('button')!.click(); vi.advanceTimersByTime(20); };
  const reset = (celebrate: boolean) => {
    editor.commands.setContent('<ul><li><p>IN PROGRESS: Finish this</p></li></ul>');
    editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, defaultBulletMethodStatuses.map(s => s.id === 'done' ? { ...s, prefix: 'FINISHED', celebrate } : s)));
  };
  try {
    reset(false); click();
    expect(document.querySelector('.bullet-status-celebration')).toBeNull();
    reset(true); click();
    expect(editor.state.doc.textContent).toBe('FINISHED: Finish this');
    expect(document.querySelector('.bullet-status-celebration')).not.toBeNull();
    reset(true);
    expect(document.querySelector('.bullet-status-celebration')).toBeNull();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    click();
    expect(document.querySelector('.bullet-status-celebration')).toBeNull();
    vi.unstubAllGlobals();
    reset(true); click();
    editor.destroy();
    expect(document.querySelector('.bullet-status-celebration')).toBeNull();
  } finally { vi.unstubAllGlobals(); editorDOM.remove(); vi.useRealTimers(); }
});

it("cycles backward with Shift-click, wraps, and supports undo without changing ordinary clicks", () => {
  const editor = make('<ul><li><p>DONE: Keep this</p></li></ul>');
  const click = (shiftKey: boolean) => editor.view.dom.querySelector<HTMLButtonElement>('button')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey }));
  for (const prefix of ['IN PROGRESS', 'TODO', 'QUESTION', 'CLOSED', 'DONE']) {
    click(true);
    expect(editor.state.doc.textContent).toBe(`${prefix}: Keep this`);
  }
  editor.commands.undo();
  expect(editor.state.doc.textContent).toBe('CLOSED: Keep this');
  click(false);
  expect(editor.state.doc.textContent).toBe('QUESTION: Keep this');
});

it("uses updated custom predecessors and skips removed statuses when Shift-clicking", () => {
  const editor = make('<ul><li><p>DONE: Work</p></li></ul>');
  const statuses = defaultBulletMethodStatuses.filter(s => s.id !== 'in-progress')
    .map(s => s.id === 'todo' ? { ...s, prefix: 'WAITING' } : s);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  expect(editor.view.dom.querySelector('button')!.title).toContain('Shift-click: WAITING');
  editor.view.dom.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  expect(editor.state.doc.textContent).toBe('WAITING: Work');
});
