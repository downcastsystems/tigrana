// @vitest-environment jsdom
import { serializeEditorSelectionForClipboard } from "./notesEditorBehavior";
import { NodeSelection } from "@tiptap/pm/state";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { FootnoteDefinitionNode, FootnoteReferenceNode, FootnoteInteractions, selectFootnote, requestFootnote, editFootnote, findFootnoteDefinition, deleteFootnote, handleEmptyFootnoteDelete, handleFootnoteArrow } from "./footnotes";
import { footnoteEntries, footnotePreview, parseFootnotes } from "../lib/footnotes";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { measureNoteText } from "../lib/noteTextStats";
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function create(markdown: string) {
  const editor = new Editor({ extensions: [StarterKit, FootnoteReferenceNode, FootnoteDefinitionNode, FootnoteInteractions], content: markdownToHtml(markdown) });
  editors.push(editor); return editor;
}

it.each([
  'Text[^1].\n\n[^1]: A footnote.',
  'Named[^Source], repeated[^source].\n\n[^Source]: **Rich** [link](Other.md) and `code`.',
  'A note[^long].\n\n[^long]: First line\n    continuation\n\n    Another paragraph.\n\n    - List item\n    - Second',
  '> Quoted reference[^q].\n\n[^q]: A quoted reference.',
  '- List reference[^list]\n\n[^list]: A list footnote.',
  'Missing[^missing].\n\n[^unused]: An unreferenced definition.',
  'Code `[^1]` and escaped \\[^2].\n\n```md\n[^1]: Literal definition\n```',
])('preserves footnote Markdown through the actual editor: %s', markdown => {
  const editor = create(markdown);
  const saved = htmlToMarkdown(editor.getHTML()).trimEnd();
  expect(saved).toBe(markdown);
});
it('numbers repeated and named references by first occurrence and renumbers after deletion', () => {
  const editor = create('One[^b] two[^a] repeat[^b].\n\n[^a]: A\n\n[^b]: B');
  const numbers = () => [...editor.view.dom.querySelectorAll('.footnote-reference')].map(node => node.getAttribute('data-number'));
  expect(numbers()).toEqual(['1', '2', '1']);
  let first = -1;
  editor.state.doc.descendants((node, pos) => { if (first < 0 && node.type.name === 'footnoteReference') first = pos; });
  editor.commands.deleteRange({ from: first, to: first + 1 });
  expect(numbers()).toEqual(['1', '2']);
});
it('reports missing, duplicate, and unreferenced definitions', () => {
  const entries = footnoteEntries('A[^missing] and B[^b].\n\n[^b]: first\n\n[^b]: second\n\n[^unused]: text');
  expect(entries).toMatchObject([
    { label: 'missing', body: null, references: 1 },
    { label: 'b', body: 'first', duplicate: true },
    { label: 'unused', references: 0 },
  ]);
  expect(parseFootnotes('`[^fake]` \\[^escaped] [url](https://example.com/[^no])').references).toEqual([]);
});
it('excludes reference labels from word counts while including footnote text', () => {
  expect(measureNoteText('Words[^name].\n\n[^name]: More words.').words).toBe(3);
});

it('keeps adjacent definitions as separate blocks', () => {
  const editor = create('Text[^a][^b].\n\n[^a]: First\n[^b]: Second');
  const saved = htmlToMarkdown(editor.getHTML());
  expect(parseFootnotes(saved).definitions.map(item => item.body)).toEqual(['First', 'Second']);
  expect(saved).not.toContain('\u0003');
});

it('jumps to the reference in the prose, cycles reused labels, and leaves content unchanged', () => {
  const editor = create('First[^a].\n\nSecond[^a].\n\n[^a]: Definition.\n\n[^unused]: No reference.');
  const references: number[] = [];
  let definition = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'footnoteReference') references.push(pos);
    if (node.type.name === 'footnoteDefinition') definition = pos;
  });
  editor.commands.setNodeSelection(definition);
  editor.setEditable(false);
  const original = editor.getJSON();
  expect(selectFootnote(editor, 'A')).toBe(true);
  expect(editor.state.selection.from).toBe(references[0]);
  expect(selectFootnote(editor, 'a')).toBe(true);
  expect(editor.state.selection.from).toBe(references[1]);
  selectFootnote(editor, 'a');
  expect(editor.state.selection.from).toBe(references[0]);
  expect(selectFootnote(editor, 'unused')).toBe(false);
  expect(editor.state.selection.from).toBe(references[0]);
  expect(editor.getJSON()).toEqual(original);
});

it('inserts directly into an editable definition and keeps undo separate from typing', () => {
  const editor = create('Before after');
  editor.commands.setTextSelection(7);
  expect(requestFootnote(editor)).toBe(true);
  expect(editor.state.selection.$from.node(-1).type.name).toBe('footnoteDefinition');
  editor.commands.insertContent('A **literal** footnote');
  expect(htmlToMarkdown(editor.getHTML())).toContain('[^1]: A');
  editor.commands.undo();
  expect(editor.state.doc.textContent).not.toContain('literal');
  editor.commands.undo();
  expect(htmlToMarkdown(editor.getHTML()).trim()).toBe('Before after');
});

it('edits formatted lists inside a definition and reloads them as blocks', () => {
  const editor = create('Text[^1].\n\n[^1]: First\n\n    - One\n    - Two\n\n    > [!NOTE]\n    > A quote');
  editFootnote(editor, '1');
  editor.commands.toggleBold();
  editor.commands.insertContent('New ');
  const saved = htmlToMarkdown(editor.getHTML());
  expect(saved).toContain('[^1]: **New **First');
  expect(saved).toContain('    - One');
  const reloaded = create(saved);
  const definition = findFootnoteDefinition(reloaded, '1')!.node;
  expect(Array.from({ length: definition.childCount }, (_, index) => definition.child(index).type.name)).toEqual(['paragraph', 'bulletList', 'blockquote', 'blockquote']);
  expect(definition.textContent).toContain('A quote');
});

it('shows the same numbers on references and definitions and sorts newly inserted footnotes', () => {
  const editor = create('First[^b]. Second[^a].\n\n[^a]: A\n\n[^b]: B');
  const labels = () => [...editor.view.dom.querySelectorAll('.footnote-definition')].map(node => node.getAttribute('data-label'));
  expect(labels()).toEqual(['b', 'a']);
  expect([...editor.view.dom.querySelectorAll('.footnote-backlink')].map(node => node.textContent)).toEqual(['1', '2']);
  editor.commands.setTextSelection(1);
  requestFootnote(editor);
  expect(labels()).toEqual(['1', 'b', 'a']);
  expect(editor.state.selection.$from.node(-1).attrs.label).toBe('1');
  editor.commands.insertContent('New first footnote');
  expect(findFootnoteDefinition(editor, '1')!.node.textContent).toBe('New first footnote');
});

it('navigates both ways without opening a dialog or intercepting content clicks', () => {
  const editor = create('Text[^1].\n\n[^1]: Editable text');
  const reference = editor.view.dom.querySelector('.footnote-reference')!;
  reference.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(editor.state.selection.$from.node(-1).type.name).toBe('footnoteDefinition');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const bodyClick = new MouseEvent('click', { bubbles: true, cancelable: true });
  editor.view.dom.querySelector('.footnote-content p')!.dispatchEvent(bodyClick);
  expect(bodyClick.defaultPrevented).toBe(false);
  editor.view.dom.querySelector('.footnote-backlink')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(editor.state.selection instanceof NodeSelection).toBe(true);
  expect((editor.state.selection as NodeSelection).node.type.name).toBe('footnoteReference');
});

it('persists an empty definition and refuses nested footnote insertion', () => {
  const editor = create('Text');
  requestFootnote(editor);
  expect(requestFootnote(editor)).toBe(false);
  const saved = htmlToMarkdown(editor.getHTML());
  expect(create(saved).view.dom.querySelectorAll('.footnote-definition')).toHaveLength(1);
});

it('shows readable sidebar text without Markdown identifiers or formatting delimiters', () => {
  expect(footnotePreview('**Bold** [link](Other.md) and `code`.\n\n- One\n- Two')).toBe('Bold link and code.\n\n• One\n• Two');
});

it('keeps newly added definitions adjacent even when the editor has a trailing paragraph', () => {
  const editor = create('One[^1]. Last.\n\n[^1]: First');
  editor.commands.setTextSelection(10);
  requestFootnote(editor);
  const definitions: { pos: number; size: number }[] = [];
  editor.state.doc.forEach((node, pos) => { if (node.type.name === 'footnoteDefinition') definitions.push({pos, size: node.nodeSize}); });
  expect(definitions).toHaveLength(2);
  expect(definitions[1].pos).toBe(definitions[0].pos + definitions[0].size);
});

it('deletes all matching references and definitions, renumbers, and supports undo and redo', () => {
  const editor = create('First[^A], repeated[^a], remaining[^b].\n\n[^A]: Remove **this**.\n\n[^b]: Keep this.');
  editFootnote(editor, 'A');
  const before = htmlToMarkdown(editor.getHTML());
  expect(deleteFootnote(editor, 'a')).toBe(true);
  const after = htmlToMarkdown(editor.getHTML());
  expect(after).toContain('First, repeated, remaining[^b].');
  expect(parseFootnotes(after).definitions.map(item => item.label)).toEqual(['b']);
  expect(editor.view.dom.querySelector('.footnote-reference')?.getAttribute('data-number')).toBe('1');
  expect(editor.view.dom.querySelector('.footnote-backlink')?.textContent).toBe('1');
  editor.commands.undo();
  expect(htmlToMarkdown(editor.getHTML())).toBe(before);
  editor.commands.redo();
  expect(htmlToMarkdown(editor.getHTML())).toBe(after);
});

it('deletes missing, orphaned, and duplicate footnotes but leaves read-only notes intact', () => {
  const editor = create('Missing[^missing].\n\n[^unused]: First\n\n[^UNUSED]: Duplicate');
  editor.setEditable(false);
  expect(deleteFootnote(editor, 'unused')).toBe(false);
  expect(findFootnoteDefinition(editor, 'unused')).not.toBeNull();
  editor.setEditable(true);
  expect(deleteFootnote(editor, 'missing')).toBe(true);
  expect(deleteFootnote(editor, 'unused')).toBe(true);
  expect(deleteFootnote(editor, 'absent')).toBe(false);
  expect(htmlToMarkdown(editor.getHTML()).trim()).toBe('Missing.');
});

it.each(['Backspace', 'Delete'])('removes an empty footnote and its references with %s, with undo', key => {
  const editor = create('First[^a], repeat[^a], second[^b].\n\n[^a]: Text\n\n[^b]: Keep');
  editFootnote(editor, 'a');
  const definition = findFootnoteDefinition(editor, 'a')!;
  editor.commands.deleteRange({ from: definition.pos + 2, to: definition.pos + 6 });
  expect(findFootnoteDefinition(editor, 'a')).not.toBeNull();
  const empty = htmlToMarkdown(editor.getHTML());
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(findFootnoteDefinition(editor, 'a')).toBeNull();
  expect(htmlToMarkdown(editor.getHTML())).toContain('First, repeat, second[^b].');
  expect(editor.view.dom.querySelector('.footnote-reference')?.getAttribute('data-number')).toBe('1');
  editor.commands.undo();
  expect(htmlToMarkdown(editor.getHTML())).toBe(empty);
  editor.commands.undo();
  expect(findFootnoteDefinition(editor, 'a')!.node.textContent).toBe('Text');
});

it('does not delete footnotes with remaining text or non-text content', () => {
  for (const body of ['Text', 'First\n\n    Second', '---']) {
    const editor = create(`Note[^a].\n\n[^a]: ${body}`);
    editFootnote(editor, 'a');
    const before = editor.getJSON();
    expect(handleEmptyFootnoteDelete(editor, new KeyboardEvent('keydown', { key: 'Backspace' }))).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  }
});

it('ignores modified deletion, composition, and read-only empty footnotes', () => {
  const editor = create('Note[^a].\n\n[^a]:');
  editFootnote(editor, 'a');
  for (const options of [{ctrlKey:true}, {metaKey:true}, {altKey:true}, {shiftKey:true}, {isComposing:true}]) {
    expect(handleEmptyFootnoteDelete(editor, new KeyboardEvent('keydown', { key: 'Delete', ...options }))).toBe(false);
  }
  editor.setEditable(false);
  expect(handleEmptyFootnoteDelete(editor, new KeyboardEvent('keydown', { key: 'Delete' }))).toBe(false);
  expect(findFootnoteDefinition(editor, 'a')).not.toBeNull();
});

it('keeps a cut-and-pasted footnote as a reference and renumbers it at its new position', () => {
  const editor = create('First[^a].\n\nSecond[^b].\n\nThird[^c].\n\n[^a]: A\n\n[^b]: B\n\n[^c]: C');
  const thirdPos = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
  editor.commands.setTextSelection({ from: thirdPos + 1, to: thirdPos + editor.state.doc.child(2).nodeSize - 1 });
  const clipboard = serializeEditorSelectionForClipboard(editor.view)!;
  editor.commands.deleteSelection();
  editor.commands.setTextSelection(1);
  editor.view.pasteHTML(clipboard.html, new Event('paste') as ClipboardEvent);
  const references = [...editor.view.dom.querySelectorAll('.footnote-reference')];
  expect(references.map(node => node.getAttribute('data-label'))).toEqual(['c', 'a', 'b']);
  expect(references.map(node => node.getAttribute('data-number'))).toEqual(['1', '2', '3']);
  expect(editor.state.doc.textContent).not.toContain('Footnote');
  expect(parseFootnotes(htmlToMarkdown(editor.getHTML())).definitions.map(item => item.label)).toEqual(['c', 'a', 'b']);
});

it('moves arrows between the body and footnotes and stops after the last footnote without changing content', () => {
  const editor = create('Text[^a][^b].\n\n[^a]: First\n\n[^b]: Second');
  vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true);
  editFootnote(editor, 'a');
  const original = editor.getJSON();
  const arrow = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };
  arrow('ArrowUp');
  expect(editor.state.selection.from).toBe(editor.state.doc.firstChild!.nodeSize - 1);
  arrow('ArrowDown');
  expect(editor.state.selection.$from.node(-1).attrs.label).toBe('a');
  arrow('ArrowDown');
  expect(editor.state.selection.$from.node(-1).attrs.label).toBe('b');
  const atSecond = editor.state.selection.from;
  arrow('ArrowDown');
  expect(editor.state.selection.from).toBe(atSecond);
  arrow('ArrowUp');
  expect(editor.state.selection.$from.node(-1).attrs.label).toBe('a');
  expect(editor.getJSON()).toEqual(original);
});

it('enters footnotes only from the final visual line of the last body textblock', () => {
  const editor = create('First.\n\n- Last body[^a].\n\n[^a]: Footnote');
  const boundary = vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true);
  const down = () => handleFootnoteArrow(editor, new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
  editor.commands.setTextSelection(1);
  expect(down()).toBe(false);
  let last = 0;
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Last body') last = pos; });
  editor.commands.setTextSelection(last);
  boundary.mockReturnValue(false);
  expect(down()).toBe(false);
  boundary.mockReturnValue(true);
  expect(down()).toBe(true);
  expect(editor.state.selection.$from.node(-1).attrs.label).toBe('a');
  expect(handleFootnoteArrow(editor, new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))).toBe(true);
  expect(editor.state.selection.$from.parent.textContent).toBe('Last body.');
  const plain = create('No footnotes.');
  vi.spyOn(plain.view, 'endOfTextblock').mockReturnValue(true);
  expect(handleFootnoteArrow(plain, new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(false);
});

it('leaves wrapped-line and internal block navigation to the editor', () => {
  const editor = create('Text[^a].\n\n[^a]: First\n\n    Second\n\n    - Last');
  const boundary = vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(false);
  editFootnote(editor, 'a');
  expect(handleFootnoteArrow(editor, new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(false);
  boundary.mockReturnValue(true);
  expect(handleFootnoteArrow(editor, new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(false);
  expect(handleFootnoteArrow(editor, new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true }))).toBe(false);
  let last = 0;
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Last') last = pos; });
  editor.commands.setTextSelection(last);
  const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  expect(handleFootnoteArrow(editor, event)).toBe(true);
  expect(editor.state.selection.from).toBe(last);
});
