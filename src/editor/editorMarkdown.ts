import { cacheEditorFootnoteEntries } from './editorFootnoteEntries';
import type { Editor } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { htmlToMarkdown, type MarkdownBlockCache } from '../lib/markdown';
import { footnoteKey } from '../lib/footnotes';
import { getMarkdownFootnoteLabels } from './footnotes';

type Labels = ReadonlyMap<string, string> | undefined;
type CachedBlock = { element: Element; labels: string[]; numbering: Labels; signature: string };
type SerializationCache = { serializer: DOMSerializer; nodes: WeakMap<PMNode, CachedBlock>; markdown: MarkdownBlockCache };
const caches = new WeakMap<Editor, SerializationCache>();
const loadedDefinitions = new WeakSet<PMNode>();

/** Only freshly parsed content is known to match its original Markdown. History
 * restores may contain edited nodes with older source attributes. */
export function seedEditorMarkdownSources(editor: Editor) {
  editor.state.doc.forEach(node => {
    if (node.type.name === 'footnoteDefinition' && node.attrs.markdown) loadedDefinitions.add(node);
  });
}

/** ProseMirror nodes are immutable. Reconvert only changed blocks, while keeping
 * the shared converter's cross-block whitespace/table rules and source fidelity. */
export function serializeEditorMarkdown(editor: Editor) {
  let cache = caches.get(editor);
  if (!cache) {
    cache = { serializer: DOMSerializer.fromSchema(editor.schema), nodes: new WeakMap(), markdown: new WeakMap() };
    caches.set(editor, cache);
  }
  const numbering = getMarkdownFootnoteLabels(editor);
  const labelFor = (label: string) => numbering?.get(footnoteKey(label)) ?? label;
  const blocks: Element[] = [];
  editor.state.doc.forEach(node => {
    let block = cache.nodes.get(node);
    if (block && block.numbering !== numbering) {
      const signature = block.labels.map(labelFor).join('\0');
      if (signature !== block.signature) {
        if (node.type.name === 'footnoteDefinition' && block.labels.length === 1) {
          // Renumbering changes the definition header, not its formatted body.
          const label = labelFor(node.attrs.label);
          block.element.setAttribute('data-markdown-label', label);
          const converted = cache.markdown.get(block.element);
          if (converted) converted.markdown = converted.markdown.map(text => text.replace(/^\[\^[^\]]+\]:/, () => `[^${label}]:`));
        } else {
          block = undefined;
        }
      }
      if (block) { block.numbering = numbering; block.signature = signature; }
    }
    if (!block) {
      const labels: string[] = node.type.name === 'footnoteDefinition' ? [node.attrs.label] : [];
      node.descendants(child => { if (child.type.name === 'footnoteReference') labels.push(child.attrs.label); });
      block = { element: cache.serializer.serializeNode(node) as Element, labels, numbering, signature: labels.map(labelFor).join('\0') };
      cache.nodes.set(node, block);
      if (loadedDefinitions.has(node) && labels.length === 1) {
        cache.markdown.set(block.element, { neighbors: '', markdown: [
          (node.attrs.markdown as string).replace(/^\[\^[^\]]+\]:/, () => `[^${labelFor(node.attrs.label)}]:`),
        ] });
      }
    }
    blocks.push(block.element);
  });
  const markdown = htmlToMarkdown(blocks, cache.markdown);
  cacheEditorFootnoteEntries(editor, markdown);
  return markdown;
}
