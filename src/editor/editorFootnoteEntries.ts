import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { cacheFootnoteEntries, footnoteEntries, type FootnoteEntry } from '../lib/footnotes';
import { getMarkdownFootnoteLabels } from './footnotes';

// Immutable ProseMirror nodes let prose edits retain the same definition bodies.
// Reference labels are compared in document order, independent of their offsets.
type Input = PMNode;
const nodeInputs = new WeakMap<PMNode, readonly Input[]>();
function inputsFor(node: PMNode): readonly Input[] {
  const cached = nodeInputs.get(node);
  if (cached) return cached;
  const inputs: Input[] = [];
  if (node.type.name === 'footnoteDefinition') inputs.push(node);
  else if (node.type.name === 'footnoteReference') inputs.push(node);
  // Literal Markdown syntax can become a reference on serialization. In that
  // case keep the parser as the authority, including escapes/code/link context.
  else if (node.type.name !== 'doc' && node.textContent.includes('[^')) inputs.push(node);
  else node.forEach(child => inputs.push(...inputsFor(child)));
  nodeInputs.set(node, inputs);
  return inputs;
}

type Snapshot = {
  inputs: readonly Input[];
  numbering: ReturnType<typeof getMarkdownFootnoteLabels>;
  entries: readonly FootnoteEntry[];
};
const snapshots = new WeakMap<Editor, Snapshot>();

/** Called only on explicit note loads, never on a serialized Markdown echo. */
export function seedEditorFootnoteEntries(editor: Editor, markdown: string) {
  snapshots.set(editor, {
    inputs: inputsFor(editor.state.doc),
    numbering: getMarkdownFootnoteLabels(editor),
    entries: footnoteEntries(markdown),
  });
}

/** Publish cached sidebar data alongside each Markdown snapshot. */
export function cacheEditorFootnoteEntries(editor: Editor, markdown: string) {
  const inputs = inputsFor(editor.state.doc);
  const numbering = getMarkdownFootnoteLabels(editor);
  const previous = snapshots.get(editor);
  if (!previous || previous.numbering !== numbering || previous.inputs.length !== inputs.length
    || inputs.some((input, index) => input !== previous.inputs[index])) {
    seedEditorFootnoteEntries(editor, markdown);
  } else {
    cacheFootnoteEntries(markdown, previous.entries);
  }
}
