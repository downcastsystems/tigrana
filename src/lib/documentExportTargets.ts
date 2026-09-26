import type { FolderEntry, NavigationStyle, NoteEntry } from '../types';
export type DocumentExportFormat = 'pdf' | 'docx' | 'markdown' | 'html';
export type DocumentExportTarget = { kind: 'note' | 'folder'; path: string; source?: 'sections-pane' };
export function documentExportTargets(workspace: string, navigationStyle: NavigationStyle, selectedFolder: string, activeNote: NoteEntry | null | undefined, folders: FolderEntry[]) {
  if (!workspace) return {};
  const section = selectedFolder.split('/')[0];
  // Section view keeps the section selected while a nested note is open.
  const folder = navigationStyle === 'section-view' && activeNote && activeNote.parent_path.split('/')[0] === section
    ? activeNote.parent_path : selectedFolder;
  const targets: Partial<Record<'note' | 'folder' | 'section', DocumentExportTarget>> = {};
  if (activeNote) targets.note = {kind:'note',path:activeNote.path};
  if (folder && folders.some(entry => entry.path === folder) && (navigationStyle !== 'section-view' || folder !== section)) targets.folder = {kind:'folder',path:folder};
  if (navigationStyle === 'section-view' && (!section || folders.some(entry => entry.path === section))) targets.section = {kind:'folder',path:section,source:'sections-pane'};
  return targets;
}
