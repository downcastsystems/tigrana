import { expect, it } from 'vitest';
import { decodeBulletStatusSystem, encodeBulletStatusSystem } from './bulletStatusSystem';
import { defaultBulletMethodStatuses, statusDims, statusIcon, statusShortcut } from './bulletMethod';

it('round trips order, custom names, icons, shortcuts and dim choices without display settings', () => {
  const rows = [...defaultBulletMethodStatuses].reverse().map(row => ({ ...row, dim: false }));
  rows[1] = { ...rows[1], prefix: 'WAITING', icon: 'x', shortcut: 'w:' };
  const encoded = encodeBulletStatusSystem(rows);
  const imported = decodeBulletStatusSystem(encoded);
  expect(imported.map(s => s.id)).toEqual(rows.map(s => s.id));
  for (let i = 0; i < rows.length; i++) {
    expect(imported[i].prefix).toBe(rows[i].prefix);
    expect(statusIcon(imported[i])).toBe(statusIcon(rows[i]));
    expect(statusDims(imported[i])).toBe(statusDims(rows[i]));
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
  ]) expect(() => decodeBulletStatusSystem(JSON.stringify(value))).toThrow();
  expect(() => decodeBulletStatusSystem('{')).toThrow();
});
