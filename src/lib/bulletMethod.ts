export type BulletMethodStatus = {
  id: string;
  prefix: string | null;
  description: string;
};

export const defaultBulletMethodStatuses: readonly BulletMethodStatus[] = [
  { id: "closed", prefix: "CLOSED", description: "No further action needed from you." },
  { id: "done", prefix: "DONE", description: "Completed." },
  { id: "todo", prefix: "TODO", description: "Waiting to be started." },
  { id: "in-progress", prefix: "IN PROGRESS", description: "Actively working on it." },
  { id: "no-status", prefix: null, description: "New notes or anything without a recognized status." },
];
export const bulletMethodSettingsKey = "tigrana.bulletMethod.v1";

export function validateBulletMethodStatuses(statuses: readonly BulletMethodStatus[]): string | null {
  if (statuses.filter(status => status.prefix === null).length !== 1) return "Keep exactly one No status row.";
  const prefixes = new Set<string>();
  const ids = new Set<string>();
  for (const status of statuses) {
    if (!status.id || ids.has(status.id)) return "Each status must have a unique identity.";
    ids.add(status.id);
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
    return validateBulletMethodStatuses(stored) ? defaultBulletMethodStatuses : stored;
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
