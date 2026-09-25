// Regenerate native menu pixels from the reviewed SVG sources.
// Pass the path to an installed @resvg/resvg-js package; see icons/menu/README.md.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { Resvg } = require(process.argv[2] || '@resvg/resvg-js');
for (const name of ['arrow-down-a-z', 'arrow-down-z-a', 'bullet-method']) {
  const base = new URL(`../src-tauri/icons/menu/${name}`, import.meta.url);
  const svg = readFileSync(`${base.pathname}.svg`, 'utf8');
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: 36 } }).render();
  writeFileSync(`${base.pathname}.rgba`, image.pixels);
}
