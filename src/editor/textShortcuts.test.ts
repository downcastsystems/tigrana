// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { afterEach, expect, it, vi } from "vitest";
import { TextShortcuts, textShortcutsKey } from "./textShortcuts";
import { undoTextShortcut } from "./textShortcutUndo";
import { BulletMethodMarkers, bulletMethodMarkersKey } from "./bulletMethodMarkers";
import { defaultBulletMethodStatuses } from "../lib/bulletMethod";
import { TextAlignmentExtension } from "./textAlignment";
import { ColorHighlight } from "./inlineColorMarks";
import { filterSlashCommands } from "./slashCommands";
import { htmlToMarkdown } from "../lib/markdown";
import { readTextShortcuts, writeTextShortcuts, textShortcutError, type TextShortcut } from "../lib/textShortcuts";

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); localStorage.clear(); vi.restoreAllMocks(); });
const avery = { id: "avery", name: "Avery", trigger: "n:a", markdown: "AVERY" };
const deployment = { id: "deploy", name: "Deploy", trigger: ":mdp", markdown: "- TODO: Merge\n- TODO: Deploy to dev\n- TODO: Deploy to prod" };
function make(content = '<p>n:a</p>', shortcuts: readonly TextShortcut[] = [avery]) {
  const editor = new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), TextShortcuts, BulletMethodMarkers, TextAlignmentExtension, ColorHighlight], content, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setMeta(textShortcutsKey, shortcuts).setMeta('bulletMethodDisplay', { enabled: true, replaceBullets: true }));
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}
function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to)));
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}
function enter(editor: Editor) {
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })));
}
function backspace(editor: Editor) {
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Backspace' })));
}
function selectText(editor: Editor, text: string) {
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) editor.commands.setTextSelection(pos + text.length);
  });
}
it.each(['space', 'enter', 'slash'])('restores a multiline shortcut and its caret with immediate Backspace after %s expansion', method => {
  const trigger = method === 'slash' ? '/shortcut Deploy' : deployment.trigger;
  const editor = make(`<ul><li><p>Parent</p><ul><li><p>${trigger}</p><ul><li><p>Keep child</p></li></ul></li><li><p>Keep sibling</p></li></ul></li></ul>`, [deployment]);
  selectText(editor, trigger);
  const before = editor.getHTML();
  if (method === 'space') type(editor, ' ');
  else if (method === 'enter') enter(editor);
  else filterSlashCommands('shortcut Deploy', editor)[0].run(editor, { from: editor.state.selection.from - trigger.length, to: editor.state.selection.to }, {});
  expect(editor.state.doc.textContent).toContain('TODO: Deploy to prod');
  expect(backspace(editor)).toBe(true);
  const restored = trigger + (method === 'space' ? ' ' : '');
  expect(editor.state.selection.$from.parent.textContent).toBe(restored);
  expect(editor.state.selection.$from.parentOffset).toBe(restored.length);
  expect(editor.getHTML().replace(restored, trigger)).toBe(before);
});
it('restores an empty-bullet shortcut on Backspace before normal list deletion handles it', () => {
  const editor = make('<ul><li><p>Parent</p><ul><li><p>n:a</p></li></ul></li></ul>', [{ ...avery, markdown: '- ' }]);
  selectText(editor, avery.trigger);
  enter(editor);
  expect(backspace(editor)).toBe(true);
  expect(editor.state.selection.$from.parent.textContent).toBe('n:a');
  expect(editor.state.selection.$from.depth).toBe(5);
});
it('restores a trigger delivered in one text input, including its terminating space', () => {
  const editor = make('<p></p>');
  type(editor, 'n:a ');
  expect(editor.state.doc.textContent).toBe('AVERY');
  expect(backspace(editor)).toBe(true);
  expect(editor.state.doc.textContent).toBe('n:a ');
  expect(editor.state.selection.from).toBe(5);
});
it('undoes top-level block templates together with their automatic trailing paragraph', () => {
  const editor = make('<p>:mdp</p>', [deployment]);
  type(editor, ' ');
  expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
  expect(backspace(editor)).toBe(true);
  expect(editor.getHTML()).toBe('<p>:mdp </p>');
  expect(editor.state.selection.from).toBe(6);
});
it('keeps the restored trigger marks and supports normal undo/redo of cancellation', () => {
  const editor = make('<p><em>n:a</em></p>');
  type(editor, ' ');
  expect(backspace(editor)).toBe(true);
  expect(editor.getHTML()).toBe('<p><em>n:a </em></p>');
  expect(editor.state.selection.$from.marks().map(mark => mark.type.name)).toContain('italic');
  editor.commands.undo();
  expect(editor.state.doc.textContent).toBe('AVERY');
  editor.commands.redo();
  expect(editor.state.doc.textContent).toBe('n:a ');
});
it.each(['typing', 'moving', 'settings', 'undo'])('stops offering shortcut reversal after %s', action => {
  const editor = make();
  type(editor, ' ');
  if (action === 'typing') type(editor, 'x');
  else if (action === 'moving') editor.commands.setTextSelection(1);
  else if (action === 'settings') editor.view.dispatch(editor.state.tr.setMeta(textShortcutsKey, [avery]));
  else editor.commands.undo();
  const before = editor.getHTML();
  expect(undoTextShortcut(editor)).toBe(false);
  expect(editor.getHTML()).toBe(before);
});
it('reverses only the most recent expansion without changing earlier text', () => {
  const editor = make();
  type(editor, ' ');
  type(editor, ' n:a');
  type(editor, ' ');
  expect(editor.state.doc.textContent).toBe('AVERY AVERY');
  expect(backspace(editor)).toBe(true);
  expect(editor.state.doc.textContent).toBe('AVERY n:a ');
});
it('leaves a read-only note unchanged when shortcut reversal is requested', () => {
  const editor = make();
  enter(editor);
  editor.setEditable(false);
  expect(undoTextShortcut(editor)).toBe(false);
  expect(editor.state.doc.textContent).toBe('AVERY');
});
it.each(['space', 'enter', 'slash'])('replaces the current nested bullet with list shortcuts via %s', method => {
  const trigger = method === 'slash' ? '/shortcut' : deployment.trigger;
  const editor = make(`<ul><li><p>TODO: atest</p><ul><li><p>${trigger}</p></li></ul></li></ul>`, [deployment]);
  selectText(editor, trigger);
  const before = editor.getHTML();
  if (method === 'space') type(editor, ' ');
  else if (method === 'enter') enter(editor);
  else filterSlashCommands('shortcut', editor)[0].run(editor, { from: editor.state.selection.from - trigger.length, to: editor.state.selection.to }, {});
  expect(htmlToMarkdown(editor.getHTML()).trimEnd()).toBe('- TODO: atest\n  - TODO: Merge\n  - TODO: Deploy to dev\n  - TODO: Deploy to prod');
  expect(editor.view.dom.querySelectorAll('li')).toHaveLength(4);
  expect(editor.state.selection.$from.parent.textContent).toBe('TODO: Deploy to prod');
  editor.commands.undo();
  expect(editor.getHTML()).toBe(before);
  editor.commands.redo();
  expect(editor.view.dom.querySelectorAll('li')).toHaveLength(4);
});
it('preserves siblings and existing child blocks when replacing a bullet with a list template', () => {
  const editor = make('<ul><li><p>Before</p></li><li><p>:mdp</p><ul><li><p>Keep child</p></li></ul><p>Keep details</p></li><li><p>After</p></li></ul>', [deployment]);
  selectText(editor, deployment.trigger);
  const before = editor.getHTML();
  type(editor, ' ');
  const list = editor.state.doc.firstChild!;
  expect(list.childCount).toBe(5);
  expect(Array.from({ length: list.childCount }, (_, i) => list.child(i).firstChild!.textContent)).toEqual(['Before', 'TODO: Merge', 'TODO: Deploy to dev', 'TODO: Deploy to prod', 'After']);
  expect(list.child(1).child(1).textContent).toBe('Keep child');
  expect(list.child(1).child(2).textContent).toBe('Keep details');
  expect(editor.view.dom.querySelectorAll('.bullet-method-marker-button')).toHaveLength(3);
  expect(backspace(editor)).toBe(true);
  expect(editor.getHTML().replace(':mdp ', ':mdp')).toBe(before);
});
it.each([1, 3])('keeps list shortcuts at their current depth with %s ancestor bullets', depth => {
  let content = '<ul><li><p>:mdp</p></li></ul>';
  for (let i = 0; i < depth; i++) content = `<ul><li><p>Parent ${i}</p>${content}</li></ul>`;
  const editor = make(content, [deployment]);
  selectText(editor, deployment.trigger);
  const originalDepth = editor.state.selection.$from.depth;
  type(editor, ' ');
  expect(editor.state.selection.$from.depth).toBe(originalDepth);
  expect(editor.view.dom.querySelectorAll('li')).toHaveLength(depth + 3);
});
it('replaces nested bullets with an empty-bullet shortcut without adding another level', () => {
  const editor = make('<ul><li><p>Parent</p><ul><li><p>n:a</p></li></ul></li></ul>', [{ ...avery, markdown: '- ' }]);
  selectText(editor, avery.trigger);
  type(editor, ' ');
  expect(editor.view.dom.querySelectorAll('li')).toHaveLength(2);
  expect(editor.state.selection.$from.depth).toBe(5);
  expect(editor.state.selection.$from.parent.textContent).toBe('');
});
it.each([
  ['<ol><li><p>n:a</p></li><li><p>Keep sibling</p></li></ol>', '1. First\n2. Second', 'orderedList'],
  ['<ul data-type="taskList"><li data-type="taskItem"><p>n:a</p></li><li data-type="taskItem"><p>Keep sibling</p></li></ul>', '- [ ] First\n- [x] Second', 'taskList'],
])('replaces items for matching numbered and task-list templates: %s', (content, markdown, listType) => {
  const editor = make(content, [{ ...avery, markdown }]);
  selectText(editor, avery.trigger);
  type(editor, ' ');
  const list = editor.state.doc.firstChild!;
  expect(list.type.name).toBe(listType);
  expect(list.childCount).toBe(3);
  expect(list.child(0).textContent).toBe('First');
  expect(list.child(1).textContent).toBe('Second');
  expect(list.child(2).textContent).toBe('Keep sibling');
  if (listType === 'taskList') expect(list.child(1).attrs.checked).toBe(true);
});
it('leaves inline expansion inside a nested bullet in its original paragraph', () => {
  const editor = make('<ul><li><p>Parent</p><ul><li><p>Speaker n:a</p></li></ul></li></ul>');
  selectText(editor, 'Speaker n:a');
  type(editor, ' ');
  expect(editor.state.selection.$from.parent.textContent).toBe('Speaker AVERY');
  expect(editor.view.dom.querySelectorAll('li')).toHaveLength(2);
});
it('expands on Space or Enter and supports immediate Backspace undo', () => {
  const editor = make(); type(editor, ' ');
  expect(editor.state.doc.textContent).toBe('AVERY');
  expect(backspace(editor)).toBe(true);
  expect(editor.state.doc.textContent).toBe('n:a ');
  const byEnter = make(); enter(byEnter);
  expect(byEnter.state.doc.textContent).toBe('AVERY');
  byEnter.commands.undo();
  expect(byEnter.state.doc.textContent).toBe('n:a');
});
it('expands inline after whitespace, preserving surrounding content and requiring a boundary', () => {
  const editor = make('<p>Speaker n:a after</p>');
  editor.commands.setTextSelection(12); type(editor, ' ');
  expect(editor.state.doc.textContent).toBe('Speaker AVERY after');
  const adjacent = make('<p>prefixn:a</p>'); type(adjacent, ' ');
  expect(adjacent.state.doc.textContent).toBe('prefixn:a ');
});
it.each([':ab', 'n:a', 'ab:'])('accepts a colon anywhere in a trigger: %s', trigger => {
  const shortcut = { ...avery, trigger };
  expect(textShortcutError(shortcut, [shortcut], defaultBulletMethodStatuses)).toBeNull();
  const editor = make(`<p>${trigger}</p>`, [shortcut]); type(editor, ' ');
  expect(editor.state.doc.textContent).toBe('AVERY');
});
it.each(['space', 'enter'])('allows a 64-character trigger after whitespace for %s but rejects 65 characters', method => {
  const trigger = ':' + 'a'.repeat(63);
  const shortcut = { ...avery, trigger };
  expect(textShortcutError(shortcut, [shortcut], defaultBulletMethodStatuses)).toBeNull();
  expect(textShortcutError({ ...shortcut, trigger: trigger + 'a' }, [shortcut], defaultBulletMethodStatuses)).not.toBeNull();
  const editor = make(`<p>${'x'.repeat(1000)} ${trigger}</p>`, [shortcut]);
  if (method === 'space') type(editor, ' '); else enter(editor);
  expect(editor.state.doc.textContent).toBe('x'.repeat(1000) + ' AVERY');
});
it('matches the full trigger when another shortcut is its suffix', () => {
  const longer = { ...deployment, trigger: 'xxn:a', markdown: 'Full trigger' };
  const editor = make('<p>xxn:a</p>', [avery, longer]); type(editor, ' ');
  expect(editor.state.doc.textContent).toBe('Full trigger');
});
it('leaves batched input with preceding text literal without resolving beyond the document', () => {
  const editor = make('<p></p>'); type(editor, 'Words n:a ');
  expect(editor.state.doc.textContent).toBe('Words n:a ');
});
it.each(['a', 'a:', ':a', 'abc', ';abc', '/a:b', 'a b:', ':'])('rejects unsafe triggers on save: %s', trigger => {
  expect(() => writeTextShortcuts([{ ...avery, trigger }], defaultBulletMethodStatuses)).toThrow();
});
it.each(['space', 'enter'])('requires a real boundary for %s expansion, including line breaks and nested bullets', method => {
  for (const before of ['', 'Words ', 'Words\t', 'Words&nbsp;', 'Words<br>', 'x'.repeat(1000) + ' ']) {
    const editor = make(`<ul><li><p>Parent</p><ul><li><p>${before}n:a</p></li></ul></li></ul>`);
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.endsWith('n:a')) editor.commands.setTextSelection(pos + node.nodeSize);
    });
    if (method === 'space') type(editor, ' '); else enter(editor);
    expect(editor.state.doc.textContent).toContain('AVERY');
  }
  for (const before of ['word', 'word,', 'x'.repeat(1000)]) {
    const editor = make(`<p>${before}n:a</p>`);
    if (method === 'space') type(editor, ' '); else enter(editor);
    expect(editor.state.doc.textContent).not.toContain('AVERY');
  }
});
it.each(['a', 'ab', 'abc', ';abc'])('preserves legacy %s triggers in the menu while disabling typed expansion', trigger => {
  const legacy = { ...avery, trigger };
  localStorage.setItem('tigrana.textShortcuts.v1', JSON.stringify([legacy]));
  expect(readTextShortcuts()).toEqual([legacy]);
  const editor = make(`<p>${trigger}</p>`, readTextShortcuts());
  type(editor, ' ');
  expect(editor.state.doc.textContent).toBe(`${trigger} `);
  const byEnter = make(`<p>${trigger}</p>`, readTextShortcuts());
  enter(byEnter);
  expect(byEnter.state.doc.textContent).not.toContain('AVERY');
  const command = filterSlashCommands('shortcut', editor)[0];
  expect(command.title).toBe('Avery');
  command.run(editor, { from: 1, to: editor.state.doc.content.size - 1 }, {});
  expect(editor.state.doc.textContent).toBe('AVERY');
  const added = { ...deployment };
  writeTextShortcuts([legacy, added], defaultBulletMethodStatuses, [legacy]);
  expect(readTextShortcuts()).toEqual([legacy, added]);
});
it('inserts centered, highlighted multiline Markdown and round trips it', () => {
  const markdown = '<div style="text-align: center">\n\n**AVERY**\n\n</div>\n\n==Hello==\n\n- One\n- Two';
  const editor = make(undefined, [{ ...avery, markdown }]); type(editor, ' ');
  expect(editor.state.doc.firstChild?.attrs.textAlign).toBe('center');
  expect(editor.getHTML()).toContain('<mark>');
  expect(editor.getHTML()).toContain('<ul>');
  const saved = htmlToMarkdown(editor.getHTML());
  expect(saved).toContain('<div style="text-align: center">');
  expect(saved).toContain('==Hello==');
  expect(saved).toContain('- One\n- Two');
});
it('creates an empty bullet and places the cursor inside it', () => {
  const editor = make(undefined, [{ ...avery, markdown: '- ' }]); type(editor, ' ');
  expect(editor.isActive('bulletList')).toBe(true);
  expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(editor.state.doc.textContent).toBe('');
});
it.each(['<pre><code>n:a</code></pre>', '<p><code>n:a</code></p>'])('does not expand inside code: %s', content => {
  const editor = make(content); type(editor, ' ');
  expect(editor.state.doc.textContent).toBe('n:a ');
});
it('checks live status shortcuts and names even when status shortcuts are disabled', () => {
  const editor = make();
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, defaultBulletMethodStatuses.map(status => status.id === 'todo' ? { ...status, shortcut: 'n:a' } : status)));
  type(editor, ' ');
  expect(editor.state.doc.textContent).toBe('TODO: ');
  expect(filterSlashCommands('shortcut', editor)).toEqual([]);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, defaultBulletMethodStatuses));
  expect(filterSlashCommands('shortcut', editor).map(command => command.title)).toEqual(['Avery']);
  for (const trigger of ['::', '-:', '-TODO:', 'todo:']) expect(textShortcutError({ ...avery, trigger }, [avery], defaultBulletMethodStatuses)).not.toBeNull();
});
it('lists and inserts shortcuts through /shortcut and supports searching names', () => {
  const editor = make('<p>/shortcut</p>', [avery, { id: 'b', name: 'Bo', trigger: 'n:b', markdown: '**BO**' }]);
  expect(filterSlashCommands('shortcut', editor).map(command => command.title)).toEqual(['Avery', 'Bo']);
  const command = filterSlashCommands('shortcut av', editor)[0];
  command.run(editor, { from: 1, to: 10 }, {});
  expect(editor.state.doc.textContent).toBe('AVERY');
});
it.each(['sh', 'sho', 'shor', 'short', 'shortc', 'shortcu', 'shortcut'])(
  'ranks saved shortcuts before Emoji while typing /%s', query => {
    const editor = make('<p></p>', [{ ...deployment, name: 'TODO: Merge, Deploy to dev/prod' }]);
    const matches = filterSlashCommands(query, editor).map(command => command.id);
    expect(matches[0]).toBe('shortcut-deploy');
    if ('shortcode'.startsWith(query)) expect(matches).toContain('emoji');
  },
);
it('still finds Emoji by its name and shortcode keyword', () => {
  const editor = make();
  for (const query of ['emoji', 'emoj', 'shortcode', 'shortco']) {
    expect(filterSlashCommands(query, editor)[0].id).toBe('emoji');
  }
});
it('updates shortcuts without replacing content or rebuilding the editor', () => {
  const editor = make();
  const setContent = vi.spyOn(editor.commands, 'setContent');
  editor.view.dispatch(editor.state.tr.setMeta(textShortcutsKey, [{ ...avery, markdown: 'Changed' }]));
  type(editor, ' ');
  expect(editor.state.doc.textContent).toBe('Changed');
  expect(setContent).not.toHaveBeenCalled();
});
it('persists multiline templates and rejects duplicates or conflicts before writing', () => {
  const shortcuts = [{ ...avery, markdown: 'One\n\nTwo' }];
  writeTextShortcuts(shortcuts, defaultBulletMethodStatuses);
  expect(readTextShortcuts()).toEqual(shortcuts);
  expect(() => writeTextShortcuts([avery, { ...avery, id: 'duplicate' }], defaultBulletMethodStatuses)).toThrow('unique trigger');
  expect(readTextShortcuts()).toEqual(shortcuts);
});

it('lets automatic saves repair live status conflicts one at a time while rejecting new conflicts', () => {
  const bo = { id: 'bo', name: 'Bo', trigger: 'n:b', markdown: 'BO' };
  const previous = [avery, bo];
  writeTextShortcuts(previous, defaultBulletMethodStatuses);
  const statuses = defaultBulletMethodStatuses.map(status => status.id === 'todo' ? { ...status, shortcut: 'n:a' }
    : status.id === 'in-progress' ? { ...status, shortcut: 'n:b' } : status);
  const repaired = [{ ...avery, trigger: 'name:a' }, bo];
  writeTextShortcuts(repaired, statuses, previous);
  expect(readTextShortcuts()).toEqual(repaired);
  expect(() => writeTextShortcuts([...repaired, { ...bo, id: 'new', trigger: 'n:a' }], statuses, repaired)).toThrow('conflicts with a Bullet Status');
  writeTextShortcuts([repaired[0]], statuses, repaired);
  expect(readTextShortcuts()).toEqual([repaired[0]]);
});
