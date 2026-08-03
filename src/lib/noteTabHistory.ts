export type NoteTab = {
  id: string;
  path: string | null;
  history?: string[];
  historyIndex?: number;
};

type ResolvedNoteTabHistory = {
  history: string[];
  historyIndex: number;
};

export function createNoteTab(id: string, path: string): NoteTab & { path: string };
export function createNoteTab(id: string, path: null): NoteTab & { path: null };
export function createNoteTab(id: string, path: string | null): NoteTab {
  return path
    ? { id, path, history: [path], historyIndex: 0 }
    : { id, path, history: [], historyIndex: -1 };
}

export function resolveNoteTabHistory(tab: NoteTab): ResolvedNoteTabHistory {
  if (!tab.history?.length || tab.historyIndex === undefined) {
    return tab.path
      ? { history: [tab.path], historyIndex: 0 }
      : { history: [], historyIndex: -1 };
  }

  const historyIndex = Math.min(Math.max(tab.historyIndex, 0), tab.history.length - 1);
  if (tab.path === tab.history[historyIndex]) {
    return { history: tab.history, historyIndex };
  }

  return tab.path
    ? { history: [tab.path], historyIndex: 0 }
    : { history: [], historyIndex: -1 };
}

export function visitNoteInTab(tab: NoteTab, path: string): NoteTab {
  const { history, historyIndex } = resolveNoteTabHistory(tab);
  if (tab.path === path) return { ...tab, history, historyIndex };

  const nextHistory = [...history.slice(0, historyIndex + 1), path];
  return {
    ...tab,
    path,
    history: nextHistory,
    historyIndex: nextHistory.length - 1,
  };
}

export function getNoteTabHistoryTarget(tab: NoteTab, offset: -1 | 1): string | null {
  const { history, historyIndex } = resolveNoteTabHistory(tab);
  return history[historyIndex + offset] ?? null;
}

export function moveInNoteTabHistory(tab: NoteTab, offset: -1 | 1): NoteTab {
  const { history, historyIndex } = resolveNoteTabHistory(tab);
  const nextIndex = historyIndex + offset;
  const path = history[nextIndex];
  if (!path) return { ...tab, history, historyIndex };
  return { ...tab, path, history, historyIndex: nextIndex };
}

export function replaceNoteTabPath(tab: NoteTab, oldPath: string, newPath: string): NoteTab {
  const { history, historyIndex } = resolveNoteTabHistory(tab);
  return {
    ...tab,
    path: tab.path === oldPath ? newPath : tab.path,
    history: history.map((path) => path === oldPath ? newPath : path),
    historyIndex,
  };
}

export function replaceNoteTabPathPrefix(tab: NoteTab, oldPrefix: string, newPrefix: string): NoteTab {
  const replacePrefix = (path: string) =>
    path === oldPrefix || path.startsWith(`${oldPrefix}/`)
      ? `${newPrefix}${path.slice(oldPrefix.length)}`
      : path;
  const { history, historyIndex } = resolveNoteTabHistory(tab);
  return {
    ...tab,
    path: tab.path ? replacePrefix(tab.path) : null,
    history: history.map(replacePrefix),
    historyIndex,
  };
}

export function pruneNoteTabHistory(tab: NoteTab, shouldRemove: (path: string) => boolean): NoteTab {
  const { history, historyIndex } = resolveNoteTabHistory(tab);
  const nextHistory = history.filter((path) => !shouldRemove(path));
  const nextIndex = history
    .slice(0, historyIndex + 1)
    .filter((path) => !shouldRemove(path)).length - 1;
  return {
    ...tab,
    history: nextHistory,
    historyIndex: Math.min(nextIndex, nextHistory.length - 1),
  };
}
