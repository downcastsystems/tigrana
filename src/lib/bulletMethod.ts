import { bulletMethodIcons, type BulletMethodIcon } from "./bulletMethodIcons";
export { bulletMethodIcons, type BulletMethodIcon } from "./bulletMethodIcons";
const defaultIcons: Record<string, BulletMethodIcon> = { closed: "slash", done: "check", todo: "circle", "in-progress": "dot" };
export function statusIcon(status: BulletMethodStatus): BulletMethodIcon | null {
  return status.icon ?? (Object.prototype.hasOwnProperty.call(defaultIcons, status.id) ? defaultIcons[status.id] : null);
}
export function statusDims(status: BulletMethodStatus): boolean {
  return status.prefix !== null && (status.dim ?? (status.id === "done" || status.id === "closed"));
}
export function statusCelebrates(status: BulletMethodStatus): boolean {
  return status.prefix !== null && (status.celebrate ?? status.id === "done");
}
export function statusCycles(status: BulletMethodStatus): boolean {
  return status.prefix !== null && statusIcon(status) !== null && status.cycle !== false;
}
export function firstBulletMethodStatus(statuses: readonly BulletMethodStatus[]) {
  return [...statuses].reverse().find(statusCycles);
}
export function nextBulletMethodStatus(status: BulletMethodStatus, statuses: readonly BulletMethodStatus[], direction: 1 | -1 = 1) {
  const index = statuses.findIndex(row => row.id === status.id);
  if (index < 0) return null;
  // Click upward through the sort order; Shift-click goes downward.
  // An excluded status can still enter the cycle via its icon.
  for (let step = 1; step < statuses.length; step++) {
    const candidate = statuses[(index - direction * step + statuses.length) % statuses.length];
    if (statusCycles(candidate)) return candidate;
  }
  return null;
}

export type BulletMethodStatus = {
  id: string;
  prefix: string | null;
  description: string;
  icon?: BulletMethodIcon;
  dim?: boolean;
  celebrate?: boolean;
  cycle?: boolean;
  shortcut?: string;
};

const defaultShortcuts: Record<string, string> = { todo: "::", "in-progress": ".:" };
export function statusShortcut(status: BulletMethodStatus): string {
  return status.prefix === null ? "" : status.shortcut ?? (Object.prototype.hasOwnProperty.call(defaultShortcuts, status.id) ? defaultShortcuts[status.id] : "");
}

export const defaultBulletMethodStatuses: readonly BulletMethodStatus[] = [
  { id: "closed", prefix: "CLOSED", description: "No further action needed from you." },
  { id: "done", prefix: "DONE", description: "Completed." },
  { id: "in-progress", prefix: "IN PROGRESS", description: "Actively working on it." },
  { id: "todo", prefix: "TODO", description: "Waiting to be started." },
  { id: "question", prefix: "QUESTION", description: "A question waiting for an answer.", icon: "help", shortcut: "?:" },
  { id: "no-status", prefix: null, description: "New notes or anything without a recognized status." },
];
export const bulletMethodSettingsKey = "tigrana.bulletMethod.v1";

export function validateBulletMethodShortcut(status: BulletMethodStatus, statuses: readonly BulletMethodStatus[]): string | null {
  if (status.shortcut !== undefined && typeof status.shortcut !== "string") return "Shortcuts must be text.";
  const shortcut = statusShortcut(status);
  if (shortcut === "-:") return "-: is reserved for the starting status in the progression.";
  if (!shortcut) return null;
  if (!/^\S{2,9}$/.test(shortcut) || !shortcut.includes(":")) return "Use 2–9 characters with a colon anywhere and no spaces (e.g. :q or q:).";
  if (statuses.some(other => other !== status && statusShortcut(other) === shortcut)) return "Each shortcut must be unique.";
  return null;
}

export function validateBulletMethodStatuses(statuses: readonly BulletMethodStatus[]): string | null {
  if (statuses.filter(status => status.prefix === null).length !== 1) return "Keep exactly one No status row.";
  const prefixes = new Set<string>();
  const ids = new Set<string>();
  for (const status of statuses) {
    if (!status.id || ids.has(status.id)) return "Each status must have a unique identity.";
    ids.add(status.id);
    if (status.celebrate !== undefined && typeof status.celebrate !== "boolean") return "Choose whether to celebrate each status.";
    if (status.dim !== undefined && typeof status.dim !== "boolean") return "Choose whether to dim each status.";
    if (status.cycle !== undefined && typeof status.cycle !== "boolean") return "Choose whether to include each status in the click cycle.";
    if (status.icon !== undefined && !bulletMethodIcons.includes(status.icon)) return "Choose a supported circle icon.";
    const shortcutError = validateBulletMethodShortcut(status, statuses);
    if (shortcutError) return shortcutError;
    if (status.prefix === null) continue;
    const prefix = status.prefix.trim();
    if (!prefix) return "Give each status a name.";
    if (/[:\r\n]/.test(prefix)) return "Status names cannot contain colons or line breaks.";
    const key = prefix.toUpperCase();
    if (prefixes.has(key)) return "Status names must be unique, ignoring capitalization.";
    prefixes.add(key);
  }
  return null;
}

export function readBulletMethodStatuses(): readonly BulletMethodStatus[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(bulletMethodSettingsKey) ?? "null");
    if (!Array.isArray(stored) || !stored.every(status => status && typeof status === "object"
      && typeof status.id === "string" && (typeof status.prefix === "string" || status.prefix === null)
      && typeof status.description === "string")) return defaultBulletMethodStatuses;
    // The starting-status shortcut replaces any older per-status assignment.
    const statuses = stored.map(status => status.shortcut === "-:" ? { ...status, shortcut: "" } : status);
    return validateBulletMethodStatuses(statuses) ? defaultBulletMethodStatuses : statuses;
  } catch {
    return defaultBulletMethodStatuses;
  }
}

export function writeBulletMethodStatuses(statuses: readonly BulletMethodStatus[]): readonly BulletMethodStatus[] {
  const error = validateBulletMethodStatuses(statuses);
  if (error) throw new Error(error);
  const normalized = statuses.map(status => ({ ...status, prefix: status.prefix?.trim() ?? null }));
  localStorage.setItem(bulletMethodSettingsKey, JSON.stringify(normalized));
  return normalized;
}

export function bulletMethodRank(text: string, statuses: readonly BulletMethodStatus[]): number {
  const colon = text.indexOf(":");
  const prefix = colon < 0 ? null : text.slice(0, colon).trim().toUpperCase();
  const index = statuses.findIndex(status => status.prefix !== null && status.prefix.trim().toUpperCase() === prefix);
  return index >= 0 ? index : statuses.findIndex(status => status.prefix === null);
}

export type BulletMethodDisplay = { autoSortOnClick?: boolean; shortcutsEnabled?: boolean; enabled?: boolean; replaceBullets: boolean; dimCompleted: boolean; lightPercent?: number; darkPercent?: number };
export const defaultBulletMethodDisplay: BulletMethodDisplay = { enabled: false, replaceBullets: true, dimCompleted: true };
export const bulletMethodDisplayKey = "tigrana.bulletMethod.display.v1";
export function bulletMethodDimPercent(display: BulletMethodDisplay, mode: "light" | "dark"): number {
  const value = mode === "light" ? display.lightPercent : display.darkPercent;
  return typeof value === "number" && Number.isFinite(value) ? Math.min(90, Math.max(40, Math.round(value))) : mode === "light" ? 65 : 70;
}
export function readBulletMethodDisplay(): BulletMethodDisplay {
  try {
    const stored = JSON.parse(localStorage.getItem(bulletMethodDisplayKey) ?? "null");
    return {
      enabled: stored?.enabled === true,
      ...(typeof stored?.autoSortOnClick === "boolean" ? { autoSortOnClick: stored.autoSortOnClick } : {}),
      ...(typeof stored?.shortcutsEnabled === "boolean" ? { shortcutsEnabled: stored.shortcutsEnabled } : {}),
      replaceBullets: typeof stored?.replaceBullets === "boolean" ? stored.replaceBullets : true,
      dimCompleted: typeof stored?.dimCompleted === "boolean" ? stored.dimCompleted : true,
      ...(stored?.lightPercent !== undefined ? { lightPercent: bulletMethodDimPercent(stored, "light") } : {}),
      ...(stored?.darkPercent !== undefined ? { darkPercent: bulletMethodDimPercent(stored, "dark") } : {}),
    };
  } catch { return defaultBulletMethodDisplay; }
}
export function writeBulletMethodDisplay(display: BulletMethodDisplay): BulletMethodDisplay {
  const normalized = { ...display,
    ...(display.lightPercent !== undefined ? { lightPercent: bulletMethodDimPercent(display, "light") } : {}),
    ...(display.darkPercent !== undefined ? { darkPercent: bulletMethodDimPercent(display, "dark") } : {}),
  };
  localStorage.setItem(bulletMethodDisplayKey, JSON.stringify(normalized));
  return normalized;
}
