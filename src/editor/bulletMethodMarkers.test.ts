// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { afterEach, expect, it, vi } from "vitest";
import { BulletMethodMarkers, bulletMethodMarkersKey } from "./bulletMethodMarkers";
import { defaultBulletMethodStatuses } from "../lib/bulletMethod";
import { sortSelectedLines } from "./sortLines";
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });
function make(content: string) {
  const editor = new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), BulletMethodMarkers], content });
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, replaceBullets: true, dimCompleted: true }));
  editors.push(editor);
  return editor;
}
const markers = (editor: Editor) => [...editor.view.dom.querySelectorAll('li')].map(li => li.getAttribute('data-bullet-method-marker'));

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
  const editor = make('<ul>' + Array.from({ length: 1000 }, (_, i) => `<li><p>TODO: Item ${i}</p></li>`).join('') + '</ul>');
  const before = bulletMethodMarkersKey.getState(editor.state);
  editor.commands.setTextSelection(8);
  expect(bulletMethodMarkersKey.getState(editor.state)).toBe(before);
  const unrelated = editor.state.doc.firstChild!.child(500).firstChild!;
  const read = vi.spyOn(unrelated, 'textBetween');
  editor.commands.insertContent('x');
  expect(read).not.toHaveBeenCalled();
  expect(markers(editor)).toHaveLength(1000);
});

it("cycles prefixes with isolated undo while preserving formatted body and nested notes", () => {
  const editor = make('<ul><li><p>TODO: <strong>Keep this</strong></p><ul><li><p>TODO: Child</p></li></ul></li></ul>');
  const click = () => editor.view.dom.querySelector<HTMLButtonElement>('.bullet-method-marker-button')!.click();
  for (const prefix of ['IN PROGRESS', 'DONE', 'CLOSED', 'TODO']) {
    click();
    expect(editor.state.doc.firstChild!.firstChild!.firstChild!.textContent).toBe(prefix + ': Keep this');
    expect(editor.getHTML()).toContain('<strong>Keep this</strong>');
    expect(editor.getHTML()).toContain('TODO: Child');
    expect(editor.getHTML()).not.toContain('button');
  }
  editor.commands.undo();
  expect(editor.state.doc.firstChild!.firstChild!.firstChild!.textContent).toBe('CLOSED: Keep this');
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

it("recognizes COMPLETE as a completed parent without inventing a status icon", () => {
  const editor = make('<ul><li><p>COMPLETE: Parent</p><ul><li><p>Nested note</p></li></ul></li></ul>');
  expect(editor.view.dom.querySelectorAll('li[data-bullet-method-completed]')).toHaveLength(1);
  expect(editor.view.dom.querySelector('button')).toBeNull();
  expect(editor.getHTML()).not.toContain('data-bullet-method-completed');
});

it("defaults off and removes all appearance decorations when disabled", () => {
  const editor = new Editor({ extensions: [StarterKit, BulletMethodMarkers], content: '<ul><li><p>DONE: Task</p></li></ul>' });
  editors.push(editor);
  expect(editor.view.dom.querySelector('[data-bullet-method-completed],button')).toBeNull();
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, dimCompleted: true }));
  expect(editor.view.dom.querySelector('button')).not.toBeNull();
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: false, replaceBullets: true, dimCompleted: true }));
  expect(editor.view.dom.querySelector('[data-bullet-method-completed],button')).toBeNull();
});

it("uses each status's dim choice, including renamed, custom, and unmarked items", () => {
  const editor = make('<ul><li><p>DONE: Keep bright</p></li><li><p>WAITING: Dim me</p><ul><li><p>Nested note</p></li></ul></li><li><p>Custom: Dim me too</p></li><li><p>Unmarked</p></li></ul>');
  const statuses = [...defaultBulletMethodStatuses.map(status => status.id === 'done' ? { ...status, dim: false } : status.id === 'todo' ? { ...status, prefix: 'WAITING', dim: true } : status), { id: 'custom', prefix: 'Custom', description: '', dim: true }];
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  const dimmed = () => [...editor.view.dom.querySelectorAll('p[data-bullet-method-dim]')].map(node => node.textContent);
  expect(dimmed()).toEqual(['WAITING: Dim me', 'Custom: Dim me too']);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses.map(status => status.prefix === null ? { ...status, dim: true } : status)));
  expect(dimmed()).toEqual(['WAITING: Dim me', 'Nested note', 'Custom: Dim me too', 'Unmarked']);
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true, dimCompleted: false }));
  expect(dimmed()).toEqual([]);
  expect(editor.getHTML()).not.toContain('data-bullet-method-dim');
});
