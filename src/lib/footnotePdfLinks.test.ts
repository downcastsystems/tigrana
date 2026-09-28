import { expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { installWorkerDom } from './workerDom';
import { buildNotebookExportHtml } from './notebookExport';
import { createPdf } from './exportFormats';

installWorkerDom();
it.each([false, true])('writes resolvable footnote links across pages, prepared=%s', async prepared => {
  const html = await buildNotebookExportHtml([
    {title: 'First', markdown: 'First[^a], second[^b], repeated[^a].\n\n' + 'A paragraph to push the footnotes onto a later page.\n\n'.repeat(60) + '[^a]: Alpha\n\n[^b]: Beta'},
    {title: 'Second', markdown: 'Another[^a].\n\n[^a]: Other note'},
  ]);
  const task = getDocument({data: await createPdf(html, 'Footnotes', prepared), useSystemFonts: true});
  const pdf = await task.promise;
  try {
    let count = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      for (const annotation of await page.getAnnotations()) {
        if (annotation.subtype !== 'Link') continue;
        count++;
        const target = typeof annotation.dest === 'string' ? await pdf.getDestination(annotation.dest) : annotation.dest;
        expect(target, `Missing destination ${annotation.dest}`).toBeTruthy();
        const targetPage = await pdf.getPageIndex(target[0]);
        if (annotation.dest.includes('_fn_')) expect(targetPage).toBeGreaterThanOrEqual(pageNumber - 1);
        else expect(targetPage).toBeLessThanOrEqual(pageNumber - 1);
      }
    }
    expect(count).toBe(7);
    const firstFootnote = await pdf.getDestination('note_1_fn_1');
    const firstReference = await pdf.getDestination('note_1_ref_1');
    expect(await pdf.getPageIndex(firstReference![0])).toBe(0);
    expect(await pdf.getPageIndex(firstFootnote![0])).toBeGreaterThan(0);
    const secondFootnote = await pdf.getDestination('note_2_fn_1');
    expect(await pdf.getPageIndex(secondFootnote![0])).toBe(pdf.numPages - 1);
  } finally { await task.destroy(); }
});
