// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import { FootnoteDefinitionNode, FootnoteReferenceNode, FootnoteInteractions, saveFootnote } from "./footnotes";
import { footnoteEntries, parseFootnotes } from "../lib/footnotes";
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
it('inserts and edits without replacing selected words, and supports undo', () => {
  const editor = create('Existing words');
  const pos = editor.state.doc.firstChild!.nodeSize - 1;
  expect(saveFootnote(editor, '1', 'A footnote', pos)).toBe(true);
  expect(htmlToMarkdown(editor.getHTML())).toContain('Existing words[^1]');
  expect(saveFootnote(editor, '1', 'Updated **text**')).toBe(true);
  expect(htmlToMarkdown(editor.getHTML())).toContain('[^1]: Updated **text**');
  expect(editor.state.doc.textContent).toContain('Existing words');
  editor.commands.undo();
  expect(htmlToMarkdown(editor.getHTML())).toContain('[^1]: A footnote');
  editor.commands.undo();
  expect(htmlToMarkdown(editor.getHTML()).trim()).toBe('Existing words');
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
