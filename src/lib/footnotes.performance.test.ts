import { expect, it, vi } from 'vitest';

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

import { footnoteEntries, footnotePreview, parseFootnotes } from './footnotes';
import { markdownToHtml } from './markdown';

it('parses a 1,000-footnote note only once for conversion and sidebar previews', () => {
  const markdown = Array.from({ length: 1000 }, (_, i) => `Passage[^${i + 1}].`).join('\n\n')
    + '\n\n' + Array.from({ length: 1000 }, (_, i) => `[^${i + 1}]: **Definition ${i + 1}** with a [link](Other.md).`).join('\n\n');
  work.parse.mockClear();
  const html = markdownToHtml(markdown);
  const entries = footnoteEntries(markdown);
  expect(work.parse).toHaveBeenCalledTimes(1);
  expect(entries).toHaveLength(1000);
  expect(entries[999].preview).toBe('Definition 1000 with a link.');
  expect(html.match(/data-type="footnoteDefinition"/g)).toHaveLength(1000);
  expect(html.match(/data-type="footnoteReference"/g)).toHaveLength(1000);
  expect(markdownToHtml(markdown)).toBe(html);
  expect(work.parse).toHaveBeenCalledTimes(1);
});

it('invalidates changed content and bounds the number and size of retained sources', () => {
  const a = 'Cache A[^a].\n\n[^a]: Original';
  const b = a.replace('Original', 'Edited');
  expect(parseFootnotes(a).definitions[0].body).toBe('Original');
  expect(parseFootnotes(b).definitions[0].body).toBe('Edited');
  work.parse.mockClear();
  parseFootnotes(a);
  expect(work.parse).not.toHaveBeenCalled();
  parseFootnotes('Cache C[^c].');
  parseFootnotes(b);
  expect(work.parse).toHaveBeenCalledTimes(2);
  const oversized = 'x'.repeat(1_000_001) + '[^missing]';
  const first = parseFootnotes(oversized);
  expect(parseFootnotes(oversized)).not.toBe(first);
});

it('reuses parsed formatting for previews and preserves duplicate/missing definitions', () => {
  const body = '**Bold** [link](Other.md) and `code`.\n\n- One\n- Two\n\n> Quote\n\n![Alt](image.png)';
  const markdown = `First[^a], missing[^missing].\n\n[^a]: ${body.replace(/\n/g, '\n    ')}\n\n[^a]: Duplicate\n\n[^unused]: Unused`;
  const entries = footnoteEntries(markdown);
  expect(entries[0]).toMatchObject({ preview: footnotePreview(body), duplicate: true });
  expect(entries[1]).toMatchObject({ body: null, preview: '' });
  expect(entries[2]).toMatchObject({ body: 'Unused', preview: 'Unused', references: 0 });
  const parsed = parseFootnotes(markdown);
  expect(Object.isFrozen(parsed.definitions)).toBe(true);
  expect(Object.isFrozen(parsed.definitions[0])).toBe(true);
});
