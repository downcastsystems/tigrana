// Start npm run dev, then pass a Playwright module path and optionally a base URL.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { webkit } = require(process.argv[2] || 'playwright');
const base = process.argv[3] || 'http://localhost:1422';
const output = process.argv[4] || '/tmp/tigrana-stress-results.json';
const results = { date: new Date().toISOString(), engine: 'Playwright WebKit, Vite development build', host: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model, ramGiB: os.totalmem() / 2 ** 30 }, documents: [], notebooks: [], mixed: [] };
for (const [method, sizes, key] of [['documentCase', [100, 1000, 2000, 5000], 'documents'], ['notesCase', [1000, 5000, 10000], 'notebooks'], ['mixedCase', [1000], 'mixed']]) {
  for (const size of sizes) {
    let browser;
    try {
      browser = await webkit.launch();
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/scripts/fixtures/stress.html`);
      await page.waitForFunction(() => !!window.stress);
      let timer;
      let result;
      try {
        result = await Promise.race([
          page.evaluate(({ method, size }) => window.stress[method](size), { method, size }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Case exceeded 90 seconds')), 90000); }),
        ]);
      } finally { clearTimeout(timer); }
      if (errors.length) throw new Error(errors.join('\n'));
      results[key].push(result);
      console.log(JSON.stringify({ method, ...result }));
    } catch (error) {
      results[key].push({ size, error: String(error) });
      console.error(method, size, String(error));
      break; // Stop increasing this workload after a failure.
    } finally {
      await browser?.close();
      await writeFile(output, JSON.stringify(results, null, 2));
    }
  }
}
console.log(`Results: ${output}`);
if ([...results.documents, ...results.notebooks, ...results.mixed].some(row => row.error)) process.exitCode = 1;
