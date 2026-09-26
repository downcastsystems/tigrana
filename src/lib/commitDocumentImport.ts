import { invoke } from '@tauri-apps/api/core';
import type { NoteEntry } from '../types';
import type { ImportedDocument } from './documentImport';
import { isTauri } from './desktop';
import { notebookStorage } from './notebookStorage';
import { decodeNoteEntry, encodeTitleForFilename } from './notebookNames';

export async function commitDocumentImport(workspace: string, parentPath: string, fileName: string, markdown: string, document: ImportedDocument) {
  const title = fileName.replace(/\.(pdf|docx)$/i, '').replace(/[\\:*?"<>|]/g, '-').split('').filter(char => char.charCodeAt(0) > 31).join('').trim().slice(0, 80) || 'Imported document';
  if (isTauri()) return decodeNoteEntry(await invoke<NoteEntry>('import_document_note', { payload: {
    workspace, parent_path: parentPath, title: encodeTitleForFilename(title), content: markdown,
    assets: document.assets.map(asset => ({ ...asset, bytes: Array.from(asset.bytes) })),
  } }));
  for (const asset of document.assets) {
    const path = await notebookStorage.saveAsset(workspace, new File([new Uint8Array(asset.bytes)], asset.name, { type: asset.mime }));
    markdown = markdown.split(asset.token).join(path);
  }
  for (let number = 1; number <= 1000; number++) {
    try { return await notebookStorage.createNote(workspace, parentPath, number === 1 ? title : `${title} (${number})`, markdown); }
    catch (error) { if (!String(error).includes('already exists')) throw error; }
  }
  throw new Error('Could not find an available title for this document.');
}
