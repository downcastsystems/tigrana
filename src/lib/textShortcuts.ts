import { statusShortcut, type BulletMethodStatus } from "./bulletMethod";

export type TextShortcut = { id: string; name: string; trigger: string; markdown: string };
export const textShortcutsStorageKey = "tigrana.textShortcuts.v1";
export const emptyTextShortcuts: readonly TextShortcut[] = [];

export function textShortcutTriggerError(trigger: string): string | null {
  if (!/^\S{3,64}$/.test(trigger) || !trigger.includes(":")) return "Use 3–64 characters with a colon anywhere and no whitespace, such as :sig, n:a, or ship:.";
  if (trigger.startsWith("/")) return "A leading slash is reserved for slash commands.";
  return null;
}

// These checks apply to both typed expansion and explicit slash-menu insertion.
// Older triggers can still be chosen from the menu while awaiting correction.
export function textShortcutInsertionError(shortcut: TextShortcut, shortcuts: readonly TextShortcut[], statuses: readonly BulletMethodStatus[]): string | null {
  if (!shortcut.name.trim()) return "Give this shortcut a name.";
  if (/^(?:[-*+>#`~]+|\d+[.)])$/.test(shortcut.trigger)) return "This trigger is reserved for Markdown formatting.";
  if (!shortcut.markdown.trim()) return "Add text or Markdown to insert.";
  if (shortcuts.some(other => other.id !== shortcut.id && other.trigger === shortcut.trigger)) return "Each shortcut needs a unique trigger.";
  const normalized = shortcut.trigger.toUpperCase();
  if (shortcut.trigger === "-:" || statuses.some(status => status.prefix !== null && (
    statusShortcut(status) === shortcut.trigger || normalized === `-${status.prefix.trim().toUpperCase()}:`
    || normalized === `${status.prefix.trim().toUpperCase()}:`
  ))) return "This trigger conflicts with a Bullet Status name or shortcut. Choose another trigger.";
  return null;
}

export function textShortcutError(shortcut: TextShortcut, shortcuts: readonly TextShortcut[], statuses: readonly BulletMethodStatus[]): string | null {
  return textShortcutInsertionError(shortcut, shortcuts, statuses) ?? textShortcutTriggerError(shortcut.trigger);
}

export function readTextShortcuts(): readonly TextShortcut[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(textShortcutsStorageKey) ?? "null");
    if (!Array.isArray(value)) return emptyTextShortcuts;
    const ids = new Set<string>();
    return value.filter((item): item is TextShortcut => {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || ids.has(item.id)
        || typeof item.name !== "string" || typeof item.trigger !== "string" || typeof item.markdown !== "string") return false;
      ids.add(item.id);
      return true;
    });
  } catch { return emptyTextShortcuts; }
}

export function writeTextShortcuts(shortcuts: readonly TextShortcut[], statuses: readonly BulletMethodStatus[], previousShortcuts: readonly TextShortcut[] = []): readonly TextShortcut[] {
  const ids = new Set<string>();
  for (const shortcut of shortcuts) {
    if (!shortcut.id || ids.has(shortcut.id)) throw new Error("Each shortcut needs a unique identity.");
    ids.add(shortcut.id);
    const error = textShortcutError(shortcut, shortcuts, statuses);
    // New trigger rules or live Bullet Status changes can invalidate saved
    // entries. Preserve untouched entries while each problem is repaired.
    const unchanged = previousShortcuts.some(previous => previous.id === shortcut.id
      && previous.name === shortcut.name && previous.trigger === shortcut.trigger && previous.markdown === shortcut.markdown);
    if (error && !unchanged) throw new Error(error);
  }
  const normalized = shortcuts.map(shortcut => ({ ...shortcut, name: shortcut.name.trim() }));
  localStorage.setItem(textShortcutsStorageKey, JSON.stringify(normalized));
  return normalized;
}
