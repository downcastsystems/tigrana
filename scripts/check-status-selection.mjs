// npm run dev, then: node scripts/check-status-selection.mjs /path/to/playwright http://localhost:1420
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { webkit } = require(process.argv[2] || 'playwright');
const base = process.argv[3] || 'http://localhost:1420';
const browser = await webkit.launch();
try {
  for (const word of ['TODO', 'Look']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 450 } });
    await page.goto(`${base}/scripts/fixtures/status-selection.html`);
    await page.waitForSelector('.bullet-method-marker-button');
    const box = await page.evaluate(word => {
      const p = document.querySelectorAll('.ProseMirror li p')[1];
      const text = [...p.childNodes].find(node => node.nodeType === 3);
      const start = text.textContent.indexOf(word);
      const range = document.createRange();
      range.setStart(text, start); range.setEnd(text, start + word.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, word);
    await page.mouse.dblclick(box.x, box.y);
    const selected = await page.evaluate(() => ({
      text: getSelection().toString(),
      rectCount: getSelection().getRangeAt(0).getClientRects().length,
    }));
    assert.equal(selected.text, word, 'Word selection must not include a preceding newline');
    assert.equal(selected.rectCount, 1, 'Selection must have no extra strip above the word');
    await page.keyboard.type('Changed');
    const lines = await page.evaluate(() => [...editor.view.dom.querySelectorAll('li p')].map(p => p.textContent));
    assert.deepEqual(lines, ['DONE: Prepare meeting', 'TODO: Look at report'.replace(word, 'Changed')]);
    await page.evaluate(() => editor.commands.undo());
    await page.locator('.bullet-method-marker-button').nth(1).click();
    assert.equal(await page.locator('.ProseMirror li p').nth(1).innerText(), 'IN PROGRESS: Look at report');
    await page.close();
  }
  console.log('First-word and ordinary-word selection, typing, undo, and status clicking passed in WebKit.');
} finally { await browser.close(); }
