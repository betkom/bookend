import type { BookendDB } from './db';

/**
 * Backup and restore of the whole local database to a JSON file.
 * Local-only data disappears if the browser clears storage, so this is the
 * user's safety net.
 */

export const BACKUP_FORMAT = 'bookend-backup';
export const BACKUP_VERSION = 1;

const TABLES = ['works', 'editions', 'events', 'reads', 'importBatches'] as const;
type TableName = (typeof TABLES)[number];

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
}

export async function exportBackup(db: BookendDB): Promise<Backup> {
  const tables = {} as Record<TableName, unknown[]>;
  await db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) tables[t] = await db.table(t).toArray();
  });
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables };
}

/** Replaces all local data with the backup's contents. */
export async function restoreBackup(db: BookendDB, text: string): Promise<void> {
  let data: Backup;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (data?.format !== BACKUP_FORMAT || typeof data.tables !== 'object') {
    throw new Error('That file is not a Bookend backup.');
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Bookend. Update the app first.');
  }
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      const rows = data.tables[t];
      if (Array.isArray(rows) && rows.length) await db.table(t).bulkAdd(rows);
    }
  });
}

