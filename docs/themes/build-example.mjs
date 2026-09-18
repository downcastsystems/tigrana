// Usage: node docs/themes/build-example.mjs starfall-studio
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const name = process.argv[2] ?? 'starfall-studio';
if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Use an example directory name.');
const source = new URL(`./${name}/`, import.meta.url);
const files = {};
for (const path of ['theme.json', 'theme.css', 'LICENSE', ...readdirSync(new URL('assets/', source)).map(file => `assets/${file}`)]) {
  files[path] = readFileSync(new URL(path, source));
}
const output = new URL(`./${name}.tigrana-theme`, import.meta.url);
writeFileSync(output, zipSync(files));
console.log(fileURLToPath(output));

// Ship the same portable document in the app, with no runtime file requests.
if (name === 'starfall-studio') {
  const theme = JSON.parse(files['theme.json'].toString());
  theme.id = 'builtin-starfall-studio';
  theme.design.css = files['theme.css'].toString();
  theme.design.license = files.LICENSE.toString();
  theme.design.assets = Object.fromEntries(Object.entries(files)
    .filter(([path]) => path.startsWith('assets/'))
    .map(([path, bytes]) => [path, { mime: 'image/webp', data: bytes.toString('base64') }]));
  const bundled = new URL('../../src/themes/', import.meta.url);
  mkdirSync(bundled, { recursive: true });
  writeFileSync(new URL('starfall-studio.json', bundled), JSON.stringify(theme));
}
