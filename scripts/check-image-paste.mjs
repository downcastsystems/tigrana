// npm run dev, then: node scripts/check-image-paste.mjs /path/to/playwright http://localhost:1422
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { webkit } = require(process.argv[2] || 'playwright');
const base = process.argv[3] || 'http://localhost:1422';
const browser = await webkit.launch();
try {
  for (const clipboard of ['file', 'html']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/scripts/fixtures/image-paste.html`);
    await page.waitForSelector('.ProseMirror');
    await page.evaluate(async clipboard => {
      const editor = document.querySelector('.ProseMirror').editor;
      editor.commands.setTextSelection(6);
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 200;
      canvas.getContext('2d').fillRect(0, 0, 400, 200);
      const data = new DataTransfer();
      if (clipboard === 'file') {
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        data.items.add(new File([blob], 'pasted-image.png', { type: 'image/png' }));
      } else data.setData('text/html', `<img src="${canvas.toDataURL()}">`);
      editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, clipboard);
    const image = page.locator('.image-resizable img');
    await image.waitFor();
    // Both immediate selection and selection after a position-changing edit
    // must work without leaving or reloading the Note.
    for (const editAbove of [false, true]) {
      if (editAbove) await page.evaluate(() => document.querySelector('.ProseMirror').editor.commands.insertContentAt(1, 'Caption: '));
      await image.click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.image-resize-handle').count(), 2, `${clipboard}: handles after edit=${editAbove}`);
    }
    const edge = await page.locator('.image-resize-edge').boundingBox();
    const before = (await image.boundingBox()).width;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 - 100, edge.y + edge.height / 2, { steps: 5 });
    await page.mouse.up();
    const html = await page.evaluate(() => document.querySelector('.ProseMirror').editor.getHTML());
    assert(html.includes(`width="${Math.round(before - 100)}"`), 'Resize must persist the new width');
    await page.evaluate(() => document.querySelector('.ProseMirror').editor.commands.setTextSelection(1));
    assert.equal(await page.locator('.image-resize-handle').count(), 0, 'Text selection hides image handles');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('WebKit: file/HTML paste, immediate selection, edits above images, resizing, and deselection passed.');
} finally { await browser.close(); }
