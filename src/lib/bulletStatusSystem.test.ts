import { expect, it } from 'vitest';
import { decodeBulletStatusSystem, encodeBulletStatusSystem } from './bulletStatusSystem';
import { defaultBulletMethodStatuses, statusBolds, statusCelebrates, statusCycles, statusDims, statusIcon, statusShortcut } from './bulletMethod';

it('round trips order, custom names, icons, shortcuts and dim choices without display settings', () => {
  const rows = [...defaultBulletMethodStatuses].reverse().map(row => ({ ...row, dim: false, bold: row.id === "done", cycle: row.id !== "done", celebrate: row.id === "todo" }));
  rows[1] = { ...rows[1], prefix: 'WAITING', icon: 'x', shortcut: ':w' };
  const encoded = encodeBulletStatusSystem(rows);
  const imported = decodeBulletStatusSystem(encoded);
  expect(imported.map(s => s.id)).toEqual(rows.map(s => s.id));
  for (let i = 0; i < rows.length; i++) {
    expect(imported[i].prefix).toBe(rows[i].prefix);
    expect(statusIcon(imported[i])).toBe(statusIcon(rows[i]));
    expect(statusCelebrates(imported[i])).toBe(statusCelebrates(rows[i]));
    expect(statusCycles(imported[i])).toBe(statusCycles(rows[i]));
    expect(statusDims(imported[i])).toBe(statusDims(rows[i]));
    expect(statusBolds(imported[i])).toBe(statusBolds(rows[i]));
    expect(statusShortcut(imported[i])).toBe(statusShortcut(rows[i]));
  }
  expect(Object.keys(JSON.parse(encoded))).toEqual(['format', 'version', 'statuses']);
  const withExtras = { ...JSON.parse(encoded), display: { enabled: true }, statuses: imported.map(s => ({ ...s, enabled: true })) };
  expect(decodeBulletStatusSystem(JSON.stringify(withExtras))).toEqual(imported);
  expect(defaultBulletMethodStatuses[0].prefix).toBe('CLOSED');
});

it('rejects malformed, unsupported and conflicting systems', () => {
  const file = JSON.parse(encodeBulletStatusSystem(defaultBulletMethodStatuses));
  for (const value of [null, {}, { ...file, version: 2 }, { ...file, statuses: [null] },
    { ...file, statuses: file.statuses.slice(0, -1) },
    { ...file, statuses: [...file.statuses, file.statuses[0]] },
    { ...file, statuses: file.statuses.map((s: object) => ({ ...s, icon: 'invalid' })) },
    { ...file, statuses: file.statuses.map((s: object) => ({ ...s, dim: 'yes' })) },
    { ...file, statuses: file.statuses.map((s: object) => ({ ...s, bold: 'yes' })) },
    { ...file, statuses: file.statuses.map((s: object) => ({ ...s, celebrate: 'yes' })) },
    { ...file, statuses: file.statuses.map((s: object) => ({ ...s, cycle: 'yes' })) },
  ]) expect(() => decodeBulletStatusSystem(JSON.stringify(value))).toThrow();
  expect(() => decodeBulletStatusSystem('{')).toThrow();
});

it('accepts older status system files without Bold choices and uses the new defaults', () => {
  const file = JSON.parse(encodeBulletStatusSystem(defaultBulletMethodStatuses));
  for (const row of file.statuses) delete row.bold;
  expect(decodeBulletStatusSystem(JSON.stringify(file)).map(statusBolds)).toEqual([false, false, true, true, true, false]);
});
