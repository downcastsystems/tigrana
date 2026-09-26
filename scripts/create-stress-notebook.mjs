import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { documentBody, smallNote, WORDS_PER_PAGE } from './fixtures/stress-data.mjs';

const notebook = process.argv[2];
const folderName = process.argv[3] || `Performance tests ${new Date().toISOString().replace(/[:.]/g, '-')}`;
if (!notebook || path.basename(folderName) !== folderName || folderName.startsWith('.')) {
  throw new Error('Usage: node scripts/create-stress-notebook.mjs <existing-notebook> [new-folder-name]');
}
if (!(await stat(notebook)).isDirectory()) throw new Error('Notebook must be an existing directory');
const root = path.join(notebook, folderName);
const createdAt = new Date().toISOString();
async function folder(directory) {
  await mkdir(directory); // Exclusive: never reuse or overwrite an existing fixture folder.
  await mkdir(path.join(directory, '.tigrana'));
  await writeFile(path.join(directory, '.tigrana/folder.json'), JSON.stringify({ id: randomUUID() }, null, 2), { flag: 'wx' });
}
async function note(directory, name, body) {
  const markdown = `---\n# Tigrana-managed fields.\n# Changing id or created_at can break links and creation history.\nid: ${randomUUID()}\ncreated_at: ${createdAt}\n---\n\n${body}`;
  await writeFile(path.join(directory, `${name}.md`), markdown, { flag: 'wx' });
  return Buffer.byteLength(markdown);
}
await folder(root);
await folder(path.join(root, 'Long documents'));
await folder(path.join(root, '1000 notes'));
const manifest = { createdAt, wordsPerPage: WORDS_PER_PAGE, documents: [], noteCount: 1000 };
for (const pages of [100, 1000]) {
  const body = documentBody(pages);
  const bytes = await note(path.join(root, 'Long documents'), `${pages} pages - ${pages * WORDS_PER_PAGE} words`, body);
  manifest.documents.push({ pages, words: body.trim().split(/\s+/).filter(word => word !== '##').length, bytes });
}
for (let i = 1; i <= 1000; i++) await note(path.join(root, '1000 notes'), `Stress note ${String(i).padStart(4, '0')}`, smallNote(i));
await note(root, 'Start here - performance testing', `# Performance testing\n\nThese are disposable synthetic notes. Existing notes have not been changed.\n\nA page means ${WORDS_PER_PAGE} words, not a printed page. Long documents have one heading and five paragraphs per page. They contain no images, tables, or code blocks, so those workloads need separate testing.\n\n## Long documents\n\n1. Open the 100-page note, then the 1000-page note. Notice the opening delay.\n2. Type at the beginning, middle, and end. Pause between bursts to exercise autosave.\n3. Undo and redo. Find a phrase, jump through outline headings, and scroll quickly.\n4. Switch to another note and back. Close and reopen the notebook and check that your changes survived.\n5. Try with spellcheck and the outline both enabled and disabled.\n\n## 1000 notes\n\n1. Select the 1000 notes folder. Scroll from top to bottom and select several notes.\n2. Search for stressneedle01000, then for notebook, which matches all notes.\n3. Pin, reorder, rename, and move a test note. Reopen the notebook and check the result.\n4. Observe Google Drive syncing separately from local app responsiveness.\n\nRecord app version, device, delays, and any lost edits. Browser benchmark results do not certify native app responsiveness.\n\n## Cleanup\n\nDelete only this generated folder when finished. It contains 1003 Markdown files, including this guide. Tigrana rebuilds its link cache normally.\n`);
await writeFile(path.join(root, 'fixture-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ root, ...manifest }, null, 2));
