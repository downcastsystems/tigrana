// Run against npm run dev with externally installed Playwright browsers:
// node scripts/check-table-selection.mjs /path/to/playwright http://localhost:1422
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { webkit, chromium } = require(process.argv[2] || 'playwright');
const base = process.argv[3] || 'http://localhost:1422';
for (const [name, engine] of [['WebKit', webkit], ['Chromium', chromium]]) {
  const browser = await engine.launch();
  try {
    for (const rich of [false, true]) for (const text of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
      try {
        await page.goto(`${base}/scripts/fixtures/table-selection.html?${rich ? 'rich&' : ''}${text ? 'text' : ''}`);
        await page.waitForFunction(() => window.editor);
        const original = await page.evaluate(() => editor.getJSON());
        const points = await page.evaluate(() => {
          const first = editor.view.dom.firstElementChild.getBoundingClientRect();
          const last = editor.view.dom.lastElementChild;
          const end = last.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(last);
          const textEnd = range.getBoundingClientRect();
          return {
            top: { x: first.x + 1, y: first.y + first.height / 2 },
            bottom: { x: textEnd.width ? textEnd.right + 1 : end.x + 1, y: end.y + end.height / 2 },
          };
        });
        for (const steps of [15, 50]) for (const reverse of [false, true]) {
          const start = reverse ? points.bottom : points.top;
          const finish = reverse ? points.top : points.bottom;
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
          await page.mouse.move(finish.x, finish.y, { steps });
          await page.mouse.up();
          const result = await page.evaluate(() => ({
            selected: getSelection().toString(),
            anchor: editor.state.selection.anchor,
            head: editor.state.selection.head,
            expectedEnd: editor.state.doc.content.size - 1,
            doc: editor.getJSON(),
          }));
          for (const line of ['The Goal', 'So an ideal project', 'Feature', 'MyTime', 'FlexBoard', ...(text ? ['Below table'] : [])]) {
            assert(result.selected.includes(line), `${name}: ${reverse ? 'upward' : 'downward'} drag lost ${line}`);
          }
          assert.equal(result.anchor, reverse ? result.expectedEnd : 1);
          assert.equal(result.head, reverse ? 1 : result.expectedEnd);
          assert.deepEqual(result.doc, original, 'Selection must not change content');
        }
        // The narrowed correction must leave rectangular mouse selection intact.
        const cells = await page.locator('th,td').evaluateAll(nodes => [nodes[0], nodes.at(-1)].map(node => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x + 20, y: rect.y + rect.height / 2 };
        }));
        await page.mouse.move(cells[0].x, cells[0].y);
        await page.mouse.down();
        await page.mouse.move(cells[1].x, cells[1].y, { steps: 20 });
        await page.mouse.up();
        assert.equal(await page.evaluate(() => editor.state.selection.toJSON().type), 'cell');
      } finally { await page.close(); }
    }
    console.log(`${name}: 16 range drags and 4 rectangular cell drags passed`);
  } finally { await browser.close(); }
}
