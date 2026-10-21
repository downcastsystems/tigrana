// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it } from 'vitest';
import { CodeBlockWithControls, lowlight } from './codeBlock';
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
it('starts a code block immediately on the third backtick and supports undo', () => {
  const editor = new Editor({ extensions: [StarterKit.configure({ codeBlock: false }), CodeBlockWithControls.configure({ lowlight })], content: '<p>``</p>' });
  editors.push(editor);
  editor.commands.setTextSelection(3);
  editor.view.someProp('handleTextInput', handler => handler(editor.view, 3, 3, '`', () => editor.state.tr.insertText('`', 3, 3)));
  expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock');
  expect(editor.state.doc.firstChild?.textContent).toBe('');
  editor.commands.undo();
  expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
});
