import type { OpenTarget } from "./notebookNavigation";
import { isTauri } from "./desktop";
import { getNotebookName } from "./notebookMetadata";
import { SAMPLE_WORKSPACE } from "./notebookStorage";

export const workspaceKey = "tigrana-workspace";

const recentNotebooksKey = "tigrana-recent-notebooks";

export const lastPathKey = "tigrana-last-path";

const sessionKeyPrefix = "tigrana-session:";

export type RecentNotebook = {
  path: string;
  name: string;
  lastOpenedAt: number;
};

export function readStoredLastPath(workspace: string): string | null {
  try {
    const raw = localStorage.getItem(lastPathKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { workspace?: string; path?: string };
    return parsed.workspace === workspace && typeof parsed.path === "string" ? parsed.path : null;
  } catch {
    return null;
  }
}

export type StoredSession = { openTabs: string[]; activeTab: string | null };

export function readStoredSession(workspace: string): StoredSession {
  try {
    const raw = localStorage.getItem(`${sessionKeyPrefix}${workspace}`);
    if (!raw) return { openTabs: [], activeTab: null };
    const parsed = JSON.parse(raw) as { openTabs?: unknown; activeTab?: unknown };
    const openTabs = Array.isArray(parsed.openTabs)
      ? parsed.openTabs.filter((path): path is string => typeof path === "string")
      : [];
    const activeTab = typeof parsed.activeTab === "string" ? parsed.activeTab : null;
    return { openTabs, activeTab };
  } catch {
    return { openTabs: [], activeTab: null };
  }
}

export function writeStoredSession(workspace: string, session: StoredSession) {
  try {
    localStorage.setItem(`${sessionKeyPrefix}${workspace}`, JSON.stringify(session));
  } catch {
    // ignore localStorage failures
  }
}

export function readInitialWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const workspaceParam = params.get("workspace");
  if (workspaceParam) {
    localStorage.setItem(workspaceKey, workspaceParam);
    return workspaceParam;
  }
  return localStorage.getItem(workspaceKey) || (isTauri() ? "" : SAMPLE_WORKSPACE);
}

export function readRecentNotebooks(): RecentNotebook[] {
  const raw = localStorage.getItem(recentNotebooksKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<RecentNotebook>[];
    return parsed
      .filter((entry): entry is RecentNotebook => Boolean(entry.path && entry.name && entry.lastOpenedAt))
      .map((entry) => ({ ...entry, name: getNotebookName(entry.path) }))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return [];
  }
}

export function writeRecentNotebooks(notebooks: RecentNotebook[]) {
  const next = notebooks.slice(0, 24);
  localStorage.setItem(recentNotebooksKey, JSON.stringify(next));
  return next;
}

export function touchRecentNotebook(notebooks: RecentNotebook[], path: string) {
  const next = [
    {
      path,
      name: getNotebookName(path),
      lastOpenedAt: Date.now(),
    },
    ...notebooks.filter((notebook) => notebook.path !== path),
  ];
  return next.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function readInitialOpenTarget(): OpenTarget | null {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("openKind");
  const path = params.get("openPath");
  if ((kind === "folder" || kind === "note") && path !== null) {
    return { kind, path };
  }
  return null;
}
