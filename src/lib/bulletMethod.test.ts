// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { bulletMethodRank, bulletMethodSettingsKey, defaultBulletMethodStatuses, readBulletMethodStatuses, validateBulletMethodStatuses, writeBulletMethodStatuses } from "./bulletMethod";

beforeEach(() => localStorage.clear());
describe("Bullet Method settings", () => {
  it("persists custom order, names and descriptions including the position of unmarked notes", () => {
    const statuses = [defaultBulletMethodStatuses[4], { id: "waiting", prefix: " WAITING ", description: "Someone else's turn." }, defaultBulletMethodStatuses[2]];
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
  it.each(["broken json", "{}", "null", '[{"prefix":"TODO"}]', JSON.stringify([]), JSON.stringify([defaultBulletMethodStatuses[4], defaultBulletMethodStatuses[4]])])("recovers from malformed stored configuration: %s", value => {
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
    const statuses = [{ id: "special", prefix: "WAIT (A+B)?", description: "" }, defaultBulletMethodStatuses[4]];
    expect(bulletMethodRank("wait (a+b)?: literal", statuses)).toBe(0);
    expect(bulletMethodRank("WAIT AAB: different", statuses)).toBe(1);
  });
});
