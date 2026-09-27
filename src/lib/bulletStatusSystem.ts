import { statusCelebrates, statusDims, statusIcon, statusShortcut, validateBulletMethodStatuses, type BulletMethodStatus } from './bulletMethod';

export function encodeBulletStatusSystem(statuses: readonly BulletMethodStatus[]): string {
  const error = validateBulletMethodStatuses(statuses);
  if (error) throw new Error(error);
  return JSON.stringify({ format: 'tigrana-bullet-statuses', version: 1, statuses: statuses.map(status => ({
    id: status.id, prefix: status.prefix?.trim() ?? null, description: status.description,
    ...(statusIcon(status) ? { icon: statusIcon(status) } : {}),
    celebrate: statusCelebrates(status), dim: statusDims(status), shortcut: statusShortcut(status),
  })) }, null, 2) + '\n';
}

export function decodeBulletStatusSystem(text: string): readonly BulletMethodStatus[] {
  if (text.length > 1_000_000) throw new Error('Choose a status system smaller than 1 MB.');
  const value = JSON.parse(text);
  if (!value || value.format !== 'tigrana-bullet-statuses' || value.version !== 1 || !Array.isArray(value.statuses))
    throw new Error('Choose a supported Bullet Statuses JSON file.');
  const statuses: BulletMethodStatus[] = value.statuses.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid status row.');
    const s = row as Record<string, unknown>;
    if (typeof s.id !== 'string' || !(typeof s.prefix === 'string' || s.prefix === null) || typeof s.description !== 'string')
      throw new Error('Each status needs an identity, name, and description.');
    // Copy only status fields. Display preferences never enter the import path.
    return { id: s.id, prefix: s.prefix?.trim() ?? null, description: s.description,
      ...(s.icon !== undefined ? { icon: s.icon } : {}),
      ...(s.celebrate !== undefined ? { celebrate: s.celebrate } : {}),
      ...(s.dim !== undefined ? { dim: s.dim } : {}),
      ...(s.shortcut !== undefined ? { shortcut: s.shortcut } : {}),
    } as BulletMethodStatus;
  });
  const error = validateBulletMethodStatuses(statuses);
  if (error) throw new Error(error);
  return statuses;
}
