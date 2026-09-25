// Run against npm run dev using an externally installed Playwright with WebKit:
// node scripts/check-sort-selection.mjs /path/to/playwright http://localhost:1420
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { webkit } = require(process.argv[2] || 'playwright');
const base = process.argv[3] || 'http://localhost:1420';
const browser = await webkit.launch();
try {
  for (const refresh of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
    await page.goto(`${base}/scripts/fixtures/sort-selection.html${refresh ? '?refresh' : ''}`);
    await page.waitForFunction(() => window.editor);
    await page.evaluate(() => window.selectAll());
    await page.waitForTimeout(100);
    await page.evaluate(() => window.sort());
    await page.waitForTimeout(100);
    const selection = await page.evaluate(() => window.getSelection().toString());
    assert(selection.includes('IN PROGRESS: Dashview URL shortening'));
    const rect = await page.getByText('IN PROGRESS: Dashview URL shortening', { exact: true }).boundingBox();
    const png = await page.screenshot();
    const whitePixels = await page.evaluate(async ({ data, rect }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const { data: pixels } = context.getImageData(Math.floor(rect.x), Math.floor(rect.y), Math.ceil(rect.width), Math.ceil(rect.height));
      let white = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 250 && pixels[i + 1] > 250 && pixels[i + 2] > 250) white++;
      }
      return white;
    }, { data: png.toString('base64'), rect });
    if (refresh) {
      assert(whitePixels > 30, 'Moved row must visibly render selected white text');
      await page.evaluate(async () => {
        const { refreshSortedSelectionPaint } = await import('/src/editor/sortSelectionPaint.ts');
        const host = document.querySelector('#editor');
        host.style.height = '180px'; host.style.overflow = 'auto';
        host.scrollTop = 150;
        const top = host.scrollTop;
        const state = window.editor.state;
        const first = window.editor.view.dom.firstChild;
        refreshSortedSelectionPaint(window.editor.view);
        if (host.scrollTop !== top || window.editor.state !== state || window.editor.view.dom.firstChild !== first) {
          throw new Error('Repaint must preserve scrolling, editor state, and DOM nodes');
        }
      });
      await page.evaluate(() => window.editor.commands.undo());
      assert(await page.evaluate(() => window.editor.state.doc.textContent.indexOf('IN PROGRESS') < window.editor.state.doc.textContent.indexOf('TODO: extra')));
    }
    console.log(`${refresh ? 'Fixed' : 'Baseline'}: ${whitePixels} selected-text pixels in moved row`);
    await page.close();
  }
} finally { await browser.close(); }
