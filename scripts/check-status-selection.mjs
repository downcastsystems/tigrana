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
  // DOM range rectangles alone miss WebKit's extra paint between blocks.
  // Exercise a real upward drag and inspect the screenshot's empty row gaps.
  for (const nested of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
    await page.goto(`${base}/scripts/fixtures/status-selection.html`);
    await page.waitForSelector('.bullet-method-marker-button');
    await page.addStyleTag({ content: '.ProseMirror ::selection { background: rgb(100,150,200); color: black }' });
    await page.evaluate(nested => {
      const first = '<li><p>TODO: Review the proposal and all its supporting details before sharing the final version with everyone on the team</p>';
      const last = '<li><p>IN PROGRESS: Draft the plan</p></li>';
      editor.commands.setContent(nested ? `<ul>${first}<ul>${last}</ul></li></ul>` : `<ul>${first}</li>${last}</ul>`);
    }, nested);
    const bounds = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror li p')].map(p => {
      const range = document.createRange(); range.selectNodeContents(p);
      return [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    }));
    const first = bounds[0][0];
    const previous = bounds[0].at(-1);
    const last = bounds[1].at(-1);
    await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 1, first.y + first.height / 2, { steps: 20 });
    await page.mouse.up();
    assert.match(await page.evaluate(() => getSelection().toString()), /TODO:.*IN PROGRESS:/s);
    await page.waitForTimeout(100);
    const png = await page.screenshot();
    const counts = await page.evaluate(async ({ data, previous, next }) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const countBlue = (y, height) => {
        const pixels = ctx.getImageData(35, y, 930, height).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 2] - pixels[i] > 60 && pixels[i + 1] - pixels[i] > 25) count++;
        }
        return count;
      };
      const gapStart = Math.ceil(previous.y + previous.height) + 1;
      const gapEnd = Math.floor(next.y) - 1;
      return { gap: countBlue(gapStart, gapEnd - gapStart), text: countBlue(Math.ceil(next.y), Math.floor(next.height)) };
    }, { data: png.toString('base64'), previous, next: bounds[1][0] });
    assert.equal(counts.gap, 0, `${nested ? 'Nested' : 'Flat'} list must not paint a selected strip between rows`);
    assert(counts.text > 100, 'The selected text must still visibly highlight');
    await page.close();
  }
  console.log('First-word and ordinary-word selection, typing, undo, and status clicking, and flat/nested upward-drag selection painting passed in WebKit.');
} finally { await browser.close(); }
