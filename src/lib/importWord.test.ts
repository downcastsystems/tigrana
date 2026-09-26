// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importWord } from './importWord';
import { htmlToMarkdown } from './markdown';
import { inlineColors } from './inlineColors';
const zip = (parts: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])));
const body = (content: string) => `<w:document xmlns:w="word" xmlns:r="relationships" xmlns:a="drawing"><w:body>${content}</w:body></w:document>`;
describe('Word import', () => {
  it('keeps styled headings, colored text, tables, images and omits headers', () => {
    const imported = importWord(zip({
      'word/document.xml': body('<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>Heading</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/><w:color w:val="0000FF"/></w:rPr><w:t>Blue body</w:t></w:r><w:r><w:drawing><a:blip r:embed="image1"/></w:drawing></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'),
      'word/styles.xml': '<w:styles xmlns:w="word"><w:style w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>',
      'word/_rels/document.xml.rels': '<Relationships><Relationship Id="image1" Target="media/image.png"/></Relationships>',
      'word/media/image.png': new Uint8Array([1, 2, 3]),
      'word/header1.xml': '<header>Excluded header</header>',
    }));
    expect(imported.html).toContain('<h2>Heading</h2>');
    expect(imported.html).toContain(inlineColors.find(c => c.id === 'blue')!.text.light);
    expect(imported.html).toContain('<strong>Blue body</strong>');
    expect(imported.assets).toHaveLength(1);
    const markdown = htmlToMarkdown(imported.html);
    expect(markdown).toContain('## Heading');
    expect(markdown).toContain('Cell text');
    expect(markdown).toContain(imported.assets[0].token);
    expect(markdown).not.toContain('Excluded header');
  });
  it('rejects old or malformed documents', () => { expect(() => importWord(zip({ 'unrelated.xml': '' }))).toThrow('supported Word'); });
});
