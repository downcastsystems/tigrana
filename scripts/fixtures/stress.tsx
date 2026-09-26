import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NotesEditor } from '../../src/editor/NotesEditor';
import { NotesPane } from '../../src/components/navigation/NotesPane';
import { defaultWorkspaceMetadata } from '../../src/lib/notebookStorage';
import { readNoteDocument } from '../../src/lib/noteDocument';
import { searchNotes } from '../../src/lib/search';
import type { EditorPersistenceHandle } from '../../src/editor/editorContract';
import type { Editor } from '@tiptap/core';
import { documentBody, smallNote } from './stress-data.mjs';
import '../../src/styles/app.css';

const root = createRoot(document.getElementById('root')!);
document.documentElement.dataset.theme = 'dark';
const noop = () => undefined;
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const time = <T,>(fn: () => T) => { const start = performance.now(); const value = fn(); return { value, ms: performance.now() - start }; };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };

async function documentCase(pages: number) {
  const body = documentBody(pages);
  const parsed = time(() => readNoteDocument(body, 'Stress'));
  let handle: EditorPersistenceHandle | null = null;
  let changes = 0;
  let saved = '';
  const props = {
    content: body, editable: true, findRequest: 0, focusAtEndRequest: 0, focusRequest: 0,
    historyKey: 'stress', notePath: 'Stress.md', workspace: '/Stress', restorePosition: null,
    spellcheckEnabled: true, onChange: (markdown: string) => { changes++; saved = markdown; },
    onLoadError: (error: unknown) => { throw error; }, onPendingChange: noop, onPositionChange: noop,
    onPersistenceReady: (next: EditorPersistenceHandle | null) => { handle = next; },
  };
  const started = performance.now();
  flushSync(() => root.render(<section className="note-surface"><NotesEditor {...props} /></section>));
  await frame();
  const openMs = performance.now() - started;
  const element = document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor };
  const editor = element.editor;
  check(editor.state.doc.childCount === pages * 6, 'All headings and paragraphs must load');
  check(editor.state.doc.textContent.includes(`Page ${pages}`), 'Last page must load');
  const edits = [];
  const captures = [];
  for (const location of ['start', 'middle', 'end']) {
    const size = editor.state.doc.content.size;
    const position = location === 'start' ? 1 : location === 'end' ? size - 1 : Math.floor(size / 2);
    const before = changes;
    const timing = time(() => {
      for (let i = 0; i < 10; i++) editor.view.dispatch(editor.state.tr.insertText('x', position + i));
    });
    check(changes === before, 'No parent serialization during a typing burst');
    const capture = time(() => handle!.capture());
    check(capture.value?.markdown.includes('xxxxxxxxxx'), 'Edited text must be captured');
    check(capture.value?.markdown.includes(`## Page ${pages}\n`), 'Save must preserve the final heading');
    check(capture.value?.markdown.match(/^## /gm)?.length === pages, 'Save must preserve every page');
    // capture() returns the save payload; the deferred notification is a separate path.
    captures.push(capture.ms);
    edits.push(timing.ms);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  // Exercise the ordinary deferred update and the serialized echo path.
  const before = changes;
  editor.view.dispatch(editor.state.tr.insertText(' stress-end-marker', editor.state.doc.content.size - 1));
  await new Promise(resolve => setTimeout(resolve, 250));
  check(changes === before + 1 && saved.includes('stress-end-marker'), 'One deferred update must contain final edit');
  const doc = editor.state.doc;
  flushSync(() => root.render(<section className="note-surface"><NotesEditor {...props} content={saved} /></section>));
  check(editor.state.doc === doc, 'Serialized echo must not replace document');
  check(editor.commands.undo(), 'Undo must remain available');
  check(!editor.state.doc.textContent.includes('stress-end-marker'), 'Undo must remove the final marker');
  flushSync(() => root.render(null));
  return { pages, words: pages * 500, bytes: new TextEncoder().encode(body).length, parseMs: parsed.ms, openMs, tenTransactionsMs: edits, captureMs: captures };
}

async function notesCase(count: number) {
  const notes = Array.from({ length: count }, (_, i) => ({ path: `Stress/${i + 1}.md`, title: `Stress note ${i + 1}`, parent_path: 'Stress' }));
  const contents = new Map(notes.map((note, i) => [note.path, smallNote(i + 1)]));
  const searches = ['stressneedle01000', 'notebook', 'zzzznomatch'].map(query => {
    const samples = Array.from({ length: 3 }, () => time(() => searchNotes(notes, contents, query)));
    if (query === 'stressneedle01000') check(samples[0].value.some(note => note.path === 'Stress/1000.md'), 'Search must find note 1000');
    return { query, ms: samples.map(sample => sample.ms), results: samples[0].value.length };
  });
  const props = { contents, notes, metadata: defaultWorkspaceMetadata(), createNoteTargets: [], draggingPath: null,
    folderTitle: 'Stress', onCreateFolder: noop, onCreateNote: noop, onContextMenu: noop, onPin: noop, onPointerDragStart: noop, onSelect: noop };
  const start = performance.now();
  flushSync(() => root.render(<NotesPane {...props} activePath={null} />));
  await frame();
  const mountMs = performance.now() - start;
  check(document.querySelectorAll('.note-card').length === count, 'Every note card must render');
  const updateStart = performance.now();
  flushSync(() => root.render(<NotesPane {...props} activePath={notes[count - 1].path} />));
  await frame();
  const selectionMs = performance.now() - updateStart;
  check(document.querySelector('.note-card.is-active')?.getAttribute('data-note-path') === notes[count - 1].path, 'Last note must be selected');
  const domElements = document.querySelectorAll('*').length;
  flushSync(() => root.render(null));
  return { count, searches, mountMs, selectionMs, domElements };
}
async function mixedCase(count: number) {
  const notes = Array.from({ length: count }, (_, i) => ({ path: `${i + 1}.md`, title: `Stress note ${i + 1}`, parent_path: '' }));
  const contents = new Map(notes.map((note, i) => [note.path, smallNote(i + 1)]));
  for (const pages of [100, 1000]) {
    const path = `${pages} pages.md`;
    notes.push({ path, title: path, parent_path: '' });
    contents.set(path, documentBody(pages));
  }
  return { count: notes.length, searches: ['stressneedle01000', 'notebook', 'zzzznomatch'].map(query => {
    const samples = Array.from({ length: 3 }, () => time(() => searchNotes(notes, contents, query)));
    return { query, ms: samples.map(sample => sample.ms), results: samples[0].value.length };
  }) };
}
Object.assign(window, { stress: { documentCase, notesCase, mixedCase } });
