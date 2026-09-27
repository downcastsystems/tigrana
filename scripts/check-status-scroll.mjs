// npm run dev, then: node scripts/check-status-scroll.mjs /path/to/playwright http://localhost:1422
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { webkit } = require(process.argv[2] || 'playwright');
const base = process.argv[3] || 'http://localhost:1422';
const browser = await webkit.launch();
try {
  for (const scroll of [0, 155]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(`${base}/scripts/fixtures/status-scroll.html`);
    await page.waitForSelector('.bullet-method-marker-button');
    await page.evaluate(scroll => {
      document.querySelector('.note-surface').scrollTop = scroll;
      editor.view.focus();
    }, scroll);
    const offsets = () => page.evaluate(() => ({
      note: document.querySelector('.note-surface').scrollTop,
      page: window.scrollY,
      titlebar: document.querySelector('.app-titlebar').getBoundingClientRect().top,
    }));
    const before = await offsets();
    // Raw pointer input: locator.click() may itself scroll the target into view.
    const box = await page.locator('.bullet-method-marker-button').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.ProseMirror li p').first().innerText(), 'DONE: First task');
    assert.deepEqual(await offsets(), before, 'A visible status click must not scroll the note or app to add caret margins');
    assert.equal(await page.evaluate(() => editor.state.selection.$head.parent.textContent), 'DONE: First task');
    await page.close();
  }
  console.log('Visible status clicks preserve note and app scrolling at the note start and upper viewport edge.');
} finally { await browser.close(); }
