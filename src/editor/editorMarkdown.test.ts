// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it, vi } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from '../lib/markdown';
import { seedEditorMarkdownSources, serializeEditorMarkdown } from './editorMarkdown';
import { FootnoteDefinitionNode, FootnoteReferenceNode, FootnoteInteractions, deleteFootnote, editFootnote, requestFootnote } from './footnotes';
import { serializeEditorSelectionForClipboard } from './notesEditorBehavior';

const editors: Editor[] = [];
function create(markdown: string) {
  const editor = new Editor({ extensions: [StarterKit.configure({ trailingNode: { notAfter: ['footnoteDefinition'] } }), FootnoteDefinitionNode, FootnoteReferenceNode, FootnoteInteractions], content: markdownToHtml(markdown) });
  editors.push(editor);
  seedEditorMarkdownSources(editor);
  return editor;
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });
const source = () => Array.from({ length: 1000 }, (_, i) => `Passage ${i + 1}[^${i + 1}].`).join('\n\n')
  + '\n\n' + Array.from({ length: 1000 }, (_, i) => `[^${i + 1}]: Definition **${i + 1}**`).join('\n\n');

it('serializes only the changed paragraph when typing beside reference 999', () => {
  const editor = create(source());
  expect(serializeEditorMarkdown(editor)).toBe(htmlToMarkdown(editor.getHTML()));
  let position = 0;
  editor.state.doc.forEach((node, pos) => { if (node.type.name === 'paragraph' && node.textContent === 'Passage 999.') position = pos + 1; });
  editor.commands.setTextSelection(position);
  const serialize = vi.spyOn(DOMSerializer.prototype, 'serializeNode');
  const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
  for (const character of 'XYZ') {
    editor.view.dispatch(editor.state.tr.insertText(character));
    serializeEditorMarkdown(editor);
  }
  expect(serialize).toHaveBeenCalledTimes(3);
  expect(parse).not.toHaveBeenCalled();
  expect(serializeEditorMarkdown(editor)).toBe(htmlToMarkdown(editor.getHTML()));
});

it('moves reference 999 with one reorder step and reuses unchanged definition bodies', () => {
  const editor = create(source());
  serializeEditorMarkdown(editor);
  let position = 0;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'footnoteReference' && node.attrs.label === '999') position = pos; });
  editor.commands.setNodeSelection(position);
  const clipboard = serializeEditorSelectionForClipboard(editor.view)!;
  const reorderSteps: number[] = [];
  editor.on('transaction', ({ appendedTransactions }) => {
    for (const tr of appendedTransactions) if (tr.docChanged) reorderSteps.push(tr.steps.length);
  });
  editor.commands.deleteSelection();
  editor.commands.setTextSelection(1);
  editor.view.pasteHTML(clipboard.html, new Event('paste') as ClipboardEvent);
  expect(reorderSteps).toEqual([1, 1]);
  const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
  const saved = serializeEditorMarkdown(editor);
  expect(parse).not.toHaveBeenCalled();
  expect(saved).toContain('[^1]: Definition **999**');
  expect(saved).toBe(htmlToMarkdown(editor.getHTML()));
  editor.commands.undo();
  expect(serializeEditorMarkdown(editor)).toBe(htmlToMarkdown(editor.getHTML()));
  editor.commands.redo();
  expect(serializeEditorMarkdown(editor)).toBe(saved);
});

it('invalidates edited definitions and retains label/source fidelity through blur, insertion, deletion and undo', () => {
  const editor = create('First[^8]. Second[^4].\n\n[^8]: First\n    continuation\n\n[^4]: Second\n\n    - One\n    - Two');
  const compare = () => expect(serializeEditorMarkdown(editor)).toBe(htmlToMarkdown(editor.getHTML()));
  compare();
  editFootnote(editor, '4');
  editor.commands.insertContent('Edited ');
  compare();
  editor.view.dom.dispatchEvent(new FocusEvent('blur'));
  compare();
  editor.commands.setTextSelection(1);
  requestFootnote(editor);
  compare();
  deleteFootnote(editor, '8');
  compare();
  editor.commands.undo();
  compare();
});

it('recomputes empty-paragraph rules when code block neighbors change', () => {
  const editor = create('Before\n\n```js\nconst x = 1;\n```\n\nAfter');
  editor.commands.insertContentAt(editor.state.doc.child(0).nodeSize, { type: 'paragraph' });
  expect(serializeEditorMarkdown(editor)).toBe(htmlToMarkdown(editor.getHTML()));
  let from = 0, to = 0;
  editor.state.doc.forEach((node, pos) => { if (node.type.name === 'codeBlock') { from = pos; to = pos + node.nodeSize; } });
  editor.commands.deleteRange({ from, to });
  const saved = serializeEditorMarkdown(editor);
  expect(saved).toBe(htmlToMarkdown(editor.getHTML()));
  expect(saved).toContain('Before\n\n\nAfter');
});
