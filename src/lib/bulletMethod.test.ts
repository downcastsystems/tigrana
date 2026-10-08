// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { firstBulletMethodStatus, nextBulletMethodStatus, statusBolds, statusCycles, statusDims, bulletMethodDimPercent, bulletMethodDisplayKey, defaultBulletMethodDisplay, readBulletMethodDisplay, writeBulletMethodDisplay, bulletMethodRank, bulletMethodSettingsKey, defaultBulletMethodStatuses, readBulletMethodStatuses, validateBulletMethodStatuses, writeBulletMethodStatuses } from "./bulletMethod";

beforeEach(() => localStorage.clear());
describe("shared sort and cycle order", () => {
  it("sorts downward and cycles upward, wrapping in both directions", () => {
    expect(defaultBulletMethodStatuses.map(s => s.prefix)).toEqual(["CLOSED", "DONE", "IN PROGRESS", "TODO", "QUESTION", null]);
    let current = firstBulletMethodStatus(defaultBulletMethodStatuses)!;
    expect(current.prefix).toBe("QUESTION");
    for (const prefix of ["TODO", "IN PROGRESS", "DONE", "CLOSED", "QUESTION"]) {
      current = nextBulletMethodStatus(current, defaultBulletMethodStatuses)!;
      expect(current.prefix).toBe(prefix);
    }
    expect(nextBulletMethodStatus(current, defaultBulletMethodStatuses, -1)?.prefix).toBe("CLOSED");
  });

  it("uses the same order for custom statuses and skips excluded rows without changing ranks", () => {
    const rows = [
      { id: "todo", prefix: "RENAMED", description: "" },
      { id: "no-status", prefix: null, description: "", cycle: true },
      { id: "custom", prefix: "REVIEW", description: "", icon: "help" as const },
      { id: "done", prefix: "DONE", description: "", cycle: false },
    ];
    expect(firstBulletMethodStatus(rows)?.prefix).toBe("REVIEW");
    expect(nextBulletMethodStatus(rows[2], rows)?.prefix).toBe("RENAMED");
    expect(nextBulletMethodStatus(rows[0], rows)?.prefix).toBe("REVIEW");
    expect(nextBulletMethodStatus(rows[2], rows, -1)?.prefix).toBe("RENAMED");
    expect(nextBulletMethodStatus(rows[3], rows)?.prefix).toBe("REVIEW");
    expect(bulletMethodRank("DONE: task", rows)).toBe(3);
    writeBulletMethodStatuses(rows);
    expect(readBulletMethodStatuses()).toEqual(rows);
    expect(readBulletMethodStatuses().map(statusCycles)).toEqual([true, false, true, false]);
  });

  it("handles empty and single-status cycles without self transitions", () => {
    const none = defaultBulletMethodStatuses.map(s => ({ ...s, cycle: false }));
    expect(firstBulletMethodStatus(none)).toBeUndefined();
    expect(nextBulletMethodStatus(none[0], none)).toBeNull();
    const single = none.map(s => ({ ...s, cycle: s.id === "todo" }));
    const todo = firstBulletMethodStatus(single)!;
    expect(todo.prefix).toBe("TODO");
    expect(nextBulletMethodStatus(todo, single)).toBeNull();
    expect(nextBulletMethodStatus(todo, single, -1)).toBeNull();
    expect(nextBulletMethodStatus(single[0], single)).toEqual(todo);
    expect(firstBulletMethodStatus([])).toBeUndefined();
  });

  it("preserves old saved rows and rejects malformed cycle choices", () => {
    const legacy = defaultBulletMethodStatuses.filter(s => s.id !== "question");
    localStorage.setItem(bulletMethodSettingsKey, JSON.stringify(legacy));
    expect(readBulletMethodStatuses()).toEqual(legacy);
    expect(readBulletMethodStatuses().map(statusCycles)).toEqual([true, true, true, true, false]);
    localStorage.setItem(bulletMethodSettingsKey, JSON.stringify(legacy.map(s => ({ ...s, cycle: "yes" }))));
    expect(readBulletMethodStatuses()).toEqual(defaultBulletMethodStatuses);
  });
});

describe("Bullet Statuses settings", () => {
  it("persists custom order, names and descriptions including the position of unmarked notes", () => {
    const statuses = [defaultBulletMethodStatuses.find(status => status.id === "no-status")!, { id: "waiting", prefix: " WAITING ", description: "Someone else's turn." }, defaultBulletMethodStatuses.find(status => status.id === "todo")!];
    const saved = writeBulletMethodStatuses(statuses);
    expect(readBulletMethodStatuses()).toEqual(saved);
    expect(saved[1].prefix).toBe("WAITING");
    expect(bulletMethodRank("waiting: review", saved)).toBe(1);
    expect(bulletMethodRank("TODO: review", saved)).toBe(2);
    expect(bulletMethodRank("CLOSED: removed status", saved)).toBe(0);
    expect(bulletMethodRank("general notes", saved)).toBe(0);
    writeBulletMethodStatuses(defaultBulletMethodStatuses);
    expect(readBulletMethodStatuses()).toEqual(defaultBulletMethodStatuses);
  });
  it.each(["broken json", "{}", "null", '[{"prefix":"TODO"}]', JSON.stringify([]), JSON.stringify([defaultBulletMethodStatuses.find(status => status.id === "no-status")!, defaultBulletMethodStatuses.find(status => status.id === "no-status")!])])("recovers from malformed stored configuration: %s", value => {
    localStorage.setItem(bulletMethodSettingsKey, value);
    expect(readBulletMethodStatuses()).toEqual(defaultBulletMethodStatuses);
  });
  it.each(["", "   ", "TODO:", "NEXT\nUP", "todo"])("rejects invalid or duplicate names without overwriting settings: %s", prefix => {
    writeBulletMethodStatuses(defaultBulletMethodStatuses);
    const statuses = [...defaultBulletMethodStatuses, { id: "custom", prefix, description: "" }];
    expect(validateBulletMethodStatuses(statuses)).not.toBeNull();
    expect(() => writeBulletMethodStatuses(statuses)).toThrow();
    expect(readBulletMethodStatuses()).toEqual(defaultBulletMethodStatuses);
  });
  it("matches punctuation literally rather than treating names as expressions", () => {
    const statuses = [{ id: "special", prefix: "WAIT (A+B)?", description: "" }, defaultBulletMethodStatuses.find(status => status.id === "no-status")!];
    expect(bulletMethodRank("wait (a+b)?: literal", statuses)).toBe(0);
    expect(bulletMethodRank("WAIT AAB: different", statuses)).toBe(1);
  });
});

it("persists icon choices while accepting older settings without icons", () => {
  writeBulletMethodStatuses(defaultBulletMethodStatuses);
  expect(readBulletMethodStatuses()).toEqual(defaultBulletMethodStatuses);
  const statuses = defaultBulletMethodStatuses.map(status => ({ ...status, icon: "dashed" as const }));
  writeBulletMethodStatuses(statuses);
  expect(readBulletMethodStatuses()).toEqual(statuses);
  localStorage.setItem(bulletMethodSettingsKey, JSON.stringify(statuses.map(status => ({ ...status, icon: "unknown" }))));
  expect(readBulletMethodStatuses()).toEqual(defaultBulletMethodStatuses);
});

it("persists icon choices and ignores obsolete global Bold and Dim switches", () => {
  expect(readBulletMethodDisplay()).toEqual(defaultBulletMethodDisplay);
  writeBulletMethodDisplay({ replaceBullets: false });
  expect(readBulletMethodDisplay()).toEqual({ ...defaultBulletMethodDisplay, replaceBullets: false });
  localStorage.setItem(bulletMethodDisplayKey, JSON.stringify({ enabled: true, replaceBullets: true, autoBoldStatus: false, dimCompleted: false, lightPercent: 55, darkPercent: 75 }));
  expect(readBulletMethodDisplay()).toEqual({ ...defaultBulletMethodDisplay, enabled: true, lightPercent: 55, darkPercent: 75 });
  expect(readBulletMethodStatuses().map(statusBolds)).toEqual([false, false, true, true, true, false]);
  expect(readBulletMethodStatuses().map(statusDims)).toEqual([true, true, false, false, false, false]);
  writeBulletMethodDisplay(readBulletMethodDisplay());
  expect(JSON.parse(localStorage.getItem(bulletMethodDisplayKey)!)).not.toHaveProperty('autoBoldStatus');
  expect(JSON.parse(localStorage.getItem(bulletMethodDisplayKey)!)).not.toHaveProperty('dimCompleted');
  localStorage.setItem(bulletMethodDisplayKey, "invalid");
  expect(readBulletMethodDisplay()).toEqual(defaultBulletMethodDisplay);
});

it("keeps dimming percentages as bounded integers and preserves separate mode values", () => {
  expect(bulletMethodDimPercent(defaultBulletMethodDisplay, "light")).toBe(65);
  expect(bulletMethodDimPercent(defaultBulletMethodDisplay, "dark")).toBe(70);
  writeBulletMethodDisplay({ ...defaultBulletMethodDisplay, lightPercent: 55.7, darkPercent: 95 });
  expect(readBulletMethodDisplay()).toEqual({ ...defaultBulletMethodDisplay, lightPercent: 56, darkPercent: 90 });
  writeBulletMethodDisplay({ ...defaultBulletMethodDisplay, lightPercent: 2 });
  expect(bulletMethodDimPercent(readBulletMethodDisplay(), "light")).toBe(40);
});

it("preserves per-status dim choices and gives old configurations sensible defaults", () => {
  expect(defaultBulletMethodStatuses.map(statusDims)).toEqual([true, true, false, false, false, false]);
  const statuses = defaultBulletMethodStatuses.map(status => ({ ...status, dim: status.id === "todo" }));
  writeBulletMethodStatuses(statuses);
  expect(readBulletMethodStatuses().map(statusDims)).toEqual([false, false, false, true, false, false]);
  expect(statusDims({ id: "custom", prefix: "WAITING", description: "" })).toBe(false);
  localStorage.setItem(bulletMethodSettingsKey, JSON.stringify(statuses.map(status => status.prefix === null ? { ...status, dim: true } : status)));
  expect(statusDims(readBulletMethodStatuses().find(status => status.prefix === null)!)).toBe(false);
});

it("defaults click sorting on and persists an explicit off choice", () => {
  expect(readBulletMethodDisplay().autoSortOnClick).not.toBe(false);
  writeBulletMethodDisplay({ ...defaultBulletMethodDisplay, autoSortOnClick: false });
  expect(readBulletMethodDisplay().autoSortOnClick).toBe(false);
  writeBulletMethodDisplay({ ...defaultBulletMethodDisplay, autoSortOnClick: true });
  expect(readBulletMethodDisplay().autoSortOnClick).toBe(true);
});

it("defaults DONE collapsing off and preserves an explicit on choice", () => {
  expect(readBulletMethodDisplay().autoCollapseDone).toBe(false);
  writeBulletMethodDisplay({ ...defaultBulletMethodDisplay, autoCollapseDone: true });
  expect(readBulletMethodDisplay().autoCollapseDone).toBe(true);
  localStorage.setItem(bulletMethodDisplayKey, JSON.stringify({ autoCollapseDone: "true" }));
  expect(readBulletMethodDisplay()).toEqual(defaultBulletMethodDisplay);
});

it("defaults Bold by stable identity for legacy statuses, and persists independent per-status choices", () => {
  expect(defaultBulletMethodStatuses.map(statusBolds)).toEqual([false, false, true, true, true, false]);
  expect(statusBolds({ id: 'custom', prefix: 'WAITING', description: '' })).toBe(false);
  expect(statusBolds({ id: 'todo', prefix: 'NEXT', description: '' })).toBe(true);
  const statuses = defaultBulletMethodStatuses.map(status => ({ ...status, bold: status.id === 'done' }));
  writeBulletMethodStatuses(statuses);
  expect(readBulletMethodStatuses().map(statusBolds)).toEqual([false, true, false, false, false, false]);
  expect(readBulletMethodStatuses().map(statusDims)).toEqual([true, true, false, false, false, false]);
  localStorage.setItem(bulletMethodSettingsKey, JSON.stringify(defaultBulletMethodStatuses));
  expect(readBulletMethodStatuses().map(statusBolds)).toEqual([false, false, true, true, true, false]);
  const invalid = defaultBulletMethodStatuses.map(status => ({ ...status, bold: 'yes' }));
  expect(validateBulletMethodStatuses(invalid as unknown as typeof defaultBulletMethodStatuses)).toContain('bold');
  localStorage.setItem(bulletMethodSettingsKey, JSON.stringify(invalid));
  expect(readBulletMethodStatuses()).toEqual(defaultBulletMethodStatuses);
});

it("defaults all feature switches on, persists off choices, and ignores obsolete switches", () => {
  const on = { boldStatusesEnabled: true, dimmedStatusesEnabled: true, celebrationsEnabled: true };
  expect(readBulletMethodDisplay()).toMatchObject(on);
  localStorage.setItem(bulletMethodDisplayKey, JSON.stringify({ autoBoldStatus: false, dimCompleted: false }));
  expect(readBulletMethodDisplay()).toMatchObject(on);
  const off = { boldStatusesEnabled: false, dimmedStatusesEnabled: false, celebrationsEnabled: false };
  writeBulletMethodDisplay({ ...defaultBulletMethodDisplay, ...off });
  expect(readBulletMethodDisplay()).toMatchObject(off);
  for (const flag of Object.keys(on)) {
    localStorage.setItem(bulletMethodDisplayKey, JSON.stringify({ ...off, [flag]: 'false' }));
    expect(readBulletMethodDisplay()).toMatchObject({ ...off, [flag]: true });
  }
});
