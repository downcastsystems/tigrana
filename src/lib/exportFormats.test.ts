import { describe, it, expect, afterAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { installWorkerDom } from './workerDom';
import { htmlToMarkdown } from './markdown';
import { createPdf, createWordDocument } from './exportFormats';
const originalWindow = globalThis.window;
installWorkerDom();
afterAll(() => { Object.assign(globalThis, { window: originalWindow }); });
describe('portable document writers in the worker DOM', () => {
  it('converts imported HTML to Markdown in a cancellable worker DOM', () => {
    const markdown = htmlToMarkdown('<h2>Imported heading</h2><p><strong>Bold</strong> and <span style="color: #a83232">red</span></p><table><tr><td>Cell</td></tr></table><p><img src="tigrana-import-image" width="100"></p>');
    expect(markdown).toContain('## Imported heading');
    expect(markdown).toContain('**Bold**');
    expect(markdown).toContain('#a83232');
    expect(markdown).toContain('Cell');
    expect(markdown).toContain('tigrana-import-image');
  });
  const html = '<html><body><section class="export-note"><h1>My heading</h1><p><span style="color: #a83232">Colored text</span></p><table><tr><td><p>Table value</p></td></tr></table></section><section class="export-note"><h1>Second note</h1><p>More text</p></section></body></html>';
  it('writes Word content and section page breaks', async () => {
    const files = unzipSync(await createWordDocument(html, 'Export test', true));
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('My heading'); expect(xml).toContain('Table value'); expect(xml).toContain('a83232'); expect(xml).toContain('Second note'); expect(xml).toContain('nextPage');
  });
  it('writes a PDF with content on two pages', async () => {
    const bytes = await createPdf(html, 'Export test', true);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const content = new TextDecoder().decode(bytes);
    expect(content).toContain('/Count 2');
    expect(bytes.length).toBeGreaterThan(5000);
  });
});
