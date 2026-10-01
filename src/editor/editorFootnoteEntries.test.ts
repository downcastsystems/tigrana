// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it, vi } from 'vitest';
const work = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('remark', async importOriginal => {
  const actual = await importOriginal<typeof import('remark')>();
  return { ...actual, remark: () => {
    const processor = actual.remark();
    const parse = processor.parse.bind(processor);
    processor.parse = (...args: Parameters<typeof parse>) => { work.parse(); return parse(...args); };
    return processor;
  } };
});
import { footnoteEntries, parseFootnotes } from '../lib/footnotes';
import { markdownToHtml } from '../lib/markdown';
import { seedEditorMarkdownSources, serializeEditorMarkdown } from './editorMarkdown';
import { seedEditorFootnoteEntries } from './editorFootnoteEntries';
import { FootnoteDefinitionNode, FootnoteReferenceNode, FootnoteInteractions, deleteFootnote, editFootnote, requestFootnote } from './footnotes';
const editors: Editor[] = [];
function create(markdown: string) {
  const editor = new Editor({ extensions: [StarterKit, FootnoteDefinitionNode, FootnoteReferenceNode, FootnoteInteractions], content: markdownToHtml(markdown) });
  editors.push(editor);
  seedEditorFootnoteEntries(editor, markdown);
  seedEditorMarkdownSources(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
it('does not parse or rebuild sidebar entries when saving prose edits around 1,000 references', () => {
  const source = Array.from({ length: 1000 }, (_, i) => `Passage ${i + 1}[^${i + 1}].`).join('\n\n')
    + '\n\n' + Array.from({ length: 1000 }, (_, i) => `[^${i + 1}]: Definition **${i + 1}**`).join('\n\n');
  const editor = create(source);
  work.parse.mockClear();
  const original = footnoteEntries(serializeEditorMarkdown(editor));
  expect(work.parse).not.toHaveBeenCalled();
  for (const label of ['999', '1000']) {
    let pos = 0;
    editor.state.doc.descendants((node, position) => { if (node.type.name === 'footnoteReference' && node.attrs.label === label) pos = position; });
    for (const position of [pos, pos + 1]) {
      editor.commands.insertContentAt(position, 'Ordinary prose ');
      const saved = serializeEditorMarkdown(editor);
      expect(footnoteEntries(saved)).toBe(original);
    }
  }
  expect(work.parse).not.toHaveBeenCalled();
});
it('refreshes entries for definition edits, reference deletion, insertion, undo and note switches', () => {
  const editor = create('First[^8]. Second[^4].\n\n[^8]: Original\n\n[^4]: Other');
  const entries = () => footnoteEntries(serializeEditorMarkdown(editor));
  const original = entries();
  editFootnote(editor, '8');
  editor.commands.insertContent('Edited ');
  expect(entries()[0].preview).toContain('Edited');
  editor.view.dom.dispatchEvent(new FocusEvent('blur'));
  expect(entries()[0].label).toBe('1');
  deleteFootnote(editor, '8');
  expect(entries()).toHaveLength(1);
  editor.commands.undo();
  expect(entries()).toHaveLength(2);
  editor.commands.setTextSelection(1);
  requestFootnote(editor);
  expect(entries()).toHaveLength(3);
  editor.commands.setContent(markdownToHtml('Elsewhere[^x].\n\n[^x]: Different'));
  seedEditorFootnoteEntries(editor, 'Elsewhere[^x].\n\n[^x]: Different');
  expect(entries()).toMatchObject([{label:'x', preview:'Different'}]);
  expect(entries()).not.toBe(original);
});
it('reparses literal footnote syntax when its Markdown context changes', () => {
  const editor = create('Plain text\n\n[^a]: Definition');
  editor.commands.insertContentAt(1, '[^a]');
  let saved = serializeEditorMarkdown(editor);
  expect(footnoteEntries(saved)[0].references).toBe(parseFootnotes(saved).references.length);
  editor.commands.setTextSelection(2);
  editor.commands.toggleCodeBlock();
  saved = serializeEditorMarkdown(editor);
  expect(footnoteEntries(saved)[0].references).toBe(parseFootnotes(saved).references.length);
});
