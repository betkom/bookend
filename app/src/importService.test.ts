import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BookendDB } from './db';
import { addPaperBook, addPaperDate, findDuplicateBatch, importFile, undoBatch } from './importService';
import { exportBackup, restoreBackup } from './backup';
import { libbyImporter } from '@importers/libby';
import { spotifyImporter } from '@importers/spotify';

const csv = readFileSync(fileURLToPath(new URL('../../fixtures/libby/synthetic-timeline.csv', import.meta.url)), 'utf8');

let db: BookendDB;
beforeEach(() => {
  db = new BookendDB(`test-${Math.random()}`);
});
afterEach(async () => {
  await db.delete();
});

describe('importFile / undoBatch', () => {
  it('stores Spotify sessions as an undoable batch without confirming books or keeping private playback context', async () => {
    const text = readFileSync(fileURLToPath(new URL('../../fixtures/spotify/synthetic-extended-streaming.json', import.meta.url)), 'utf8');
    await addPaperBook(db, { title: 'A paper book', authors: [], finishedAt: '2026-03-01' });
    const { batch } = await importFile(db, spotifyImporter, text, 'spotify.json');
    const events = await db.events.where('batchId').equals(batch.id).toArray();
    expect(batch).toMatchObject({ source: 'spotify', eventCount: 4 });
    expect(events.every((event) => event.type === 'listened' && event.editionId === null)).toBe(true);
    expect(events.reduce((sum, event) => sum + event.value!, 0)).toBe(56);
    expect(JSON.stringify(events)).not.toContain('ip_addr');
    expect(await db.reads.count()).toBe(0);
    expect(await findDuplicateBatch(db, text)).toMatchObject({ id: batch.id });
    await undoBatch(db, batch.id);
    expect(await db.events.count()).toBe(1); // The unrelated paper entry survives.
    expect(await db.importBatches.count()).toBe(1);
  });

  it('stores events under one batch and undoes cleanly', async () => {
    const { batch } = await importFile(db, libbyImporter, csv, 'timeline.csv');
    expect(batch.eventCount).toBe(6);
    expect(await db.events.where('batchId').equals(batch.id).count()).toBe(6);
    expect(await findDuplicateBatch(db, csv)).toMatchObject({ id: batch.id });

    await undoBatch(db, batch.id);
    expect(await db.events.count()).toBe(0);
    expect(await db.importBatches.count()).toBe(0);
  });
});

describe('addPaperBook', () => {
  it('creates work, edition and dated events; reuses the work on a second add', async () => {
    const input = {
      title: 'Middlemarch',
      authors: ['George Eliot'],
      openLibraryWorkId: 'OL1W',
      isbn: '9780141439549',
      pages: 880,
      startedAt: '2026-01-02',
      finishedAt: '2026-02-20',
    };
    const first = await addPaperBook(db, input);
    const events = await db.events.where('batchId').equals(first.batch.id).toArray();
    expect(events.map((e) => e.type).sort()).toEqual(['finished', 'started']);
    expect(events.every((e) => e.editionId === first.edition.id && e.source === 'paper')).toBe(true);

    // A re-read of the same edition reuses Work and Edition.
    const second = await addPaperBook(db, { ...input, startedAt: undefined, finishedAt: '2026-10-01' });
    expect(second.work.id).toBe(first.work.id);
    expect(second.edition.id).toBe(first.edition.id);
    expect(await db.works.count()).toBe(1);

    await addPaperDate(db, first.edition.id, 'finished', '2026-11-01');
    expect(await db.events.where('type').equals('finished').count()).toBe(3);
  });
});

describe('backup', () => {
  it('round-trips all tables', async () => {
    await importFile(db, libbyImporter, csv, 'timeline.csv');
    await addPaperBook(db, { title: 'X', authors: [], finishedAt: '2026-03-01' });
    const backup = await exportBackup(db);

    const other = new BookendDB(`restore-${Math.random()}`);
    await restoreBackup(other, JSON.stringify(backup));
    expect(await other.events.count()).toBe(7);
    expect(await other.works.count()).toBe(1);
    expect(await other.importBatches.count()).toBe(2);
    await other.delete();
  });

  it('rejects non-backup files', async () => {
    await expect(restoreBackup(db, '{"hello":1}')).rejects.toThrow(/not a Bookend backup/);
  });
});

