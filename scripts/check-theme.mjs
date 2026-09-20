// Validate an exported theme or a source directory with the application's own parser.
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import { zipSync } from 'fflate';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run theme:check -- <theme.json | theme.tigrana-theme | source-directory>');
  process.exit(1);
}
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-theme-check', server: { middlewareMode: true }, appType: 'custom' });
try {
  const { decodeThemePackage, encodeThemePackage } = await server.ssrLoadModule('/src/lib/themePackage.ts');
  const { checkTheme } = await server.ssrLoadModule('/src/lib/themeHealth.ts');
  const { themeStylesheet } = await server.ssrLoadModule('/src/lib/themeRuntime.ts');
  const input = resolve(path);
  let bytes;
  if ((await stat(input)).isDirectory()) {
    const files = {};
    const collect = async (folder, prefix = '') => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) await collect(join(folder, entry.name), name + '/');
        else if (name === 'theme.json' || name === 'theme.css' || name === 'LICENSE' || name.startsWith('assets/')) files[name] = await readFile(join(folder, entry.name));
      }
    };
    await collect(input);
    bytes = zipSync(files);
  } else bytes = await readFile(input);
  const theme = decodeThemePackage(bytes);
  for (const mode of ['light', 'dark']) themeStylesheet(theme, mode, 'validation');
  encodeThemePackage(theme);
  const result = checkTheme(theme);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  console.log(`Valid: ${theme.name} (${theme.id}), schema ${theme.schemaVersion}. Both color schemes compile and the package round-trips.`);
  for (const warning of result.warnings) console.warn(`Review: ${warning}`);
  console.log('Inspect the live preview before sharing; CSS, transparency and artwork need visual review.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await server.close();
}
