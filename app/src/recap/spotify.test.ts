import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { BookendDB, type ReadingEvent } from '../db';
import { buildRecap, loadRecapData, recapEntries } from './data';
import { confirmSpotifyBook, prepareSpotifyBooks, spotifyBooks, spotifyFinished } from './spotify';
import { undoBatch } from '../importService';

let db: BookendDB;
beforeEach(() => { db = new BookendDB(`spotify-recap-${Math.random()}`); });
afterEach(async () => { await db.delete(); });
const event = (id: string, value: number, timestamp = '2026-01-02T12:00:00.000Z', batchId = 'batch'): ReadingEvent => ({ id, value, timestamp, batchId,
  source: 'spotify', type: 'listened', rawTitle: 'Book', rawAuthor: '', sourceItemId: 'spotify:show:book', format: 'audio', extra: { chapterUri: 'chapter' } });
const entries = async () => recapEntries(await loadRecapData(db));

it.each([[95, 100, true], [94.999, 100, false], [100, 100, true], [150, 100, true], [100, undefined, false], [100, 0, false], [0, 5, false]])('completion for %s listened / %s runtime is %s', (minutes, runtime, finished) => {
  expect(spotifyFinished(minutes, runtime)).toBe(finished);
});

it('groups by book identity, deduplicates overlapping exports, and preserves within-export plays', () => {
  const one = event('one', 30);
  const books = spotifyBooks([one, { ...one, id: 'two', batchId: 'overlap' }, { ...one, id: 'three' }, event('four', 20, '2026-01-03T12:00:00.000Z'),
    { ...one, id: 'other', sourceItemId: 'different-edition' }]);
  expect(books).toHaveLength(2);
  expect(books[0].minutes).toBe(80);
  expect(books[0].events).toHaveLength(4);
  expect(books[1].minutes).toBe(30);
});

it('prepares metadata records without changing events, automatically counts finishes when runtime arrives, and recalculates after undo', async () => {
  const first = event('first', 50, '2025-12-31T12:00:00.000Z');
  const last = event('last', 45, '2026-01-02T12:00:00.000Z', 'second');
  await db.events.bulkAdd([first, last]);
  await db.importBatches.bulkAdd(['batch', 'second'].map((id) => ({ id, source: 'spotify' as const, fileName: 'history.json', importedAt: last.timestamp, eventCount: 1 })));
  await prepareSpotifyBooks(db); await prepareSpotifyBooks(db);
  expect(await db.editions.count()).toBe(1);
  expect(await db.events.toArray()).toEqual([first, last]);
  expect(await entries()).toHaveLength(0);
  const book = spotifyBooks(await db.events.toArray())[0];
  await db.editions.update(book.editionId, { durationMinutes: 100 });
  expect(await db.reads.count()).toBe(0); // Automatic decisions remain tied to current evidence.
  const recap = buildRecap(await entries(), { year: 2026 });
  expect(recap).toMatchObject({ total: 1, minutes: 95, sources: { spotify: 1 } });
  expect(recap.finished[0]).toMatchObject({ startedAt: first.timestamp, finishedAt: last.timestamp });
  expect(buildRecap(await entries(), { year: 2025 }).total).toBe(0);
  await undoBatch(db, 'second');
  expect(await entries()).toHaveLength(0);
});

it.each(['finished', 'abandoned', 'not-read'] as const)('explicit %s wins over automatic status and can be reset', async (status) => {
  await db.events.add(event('one', 110));
  await prepareSpotifyBooks(db);
  const book = spotifyBooks(await db.events.toArray())[0];
  await db.editions.update(book.editionId, { durationMinutes: 100 });
  await confirmSpotifyBook(db, book, status, status === 'not-read' ? '' : '2026-01-04', '2026-01-01');
  expect(await entries()).toHaveLength(1);
  expect((await entries())[0].status).toBe(status);
  expect(buildRecap(await entries(), { year: 2026 }).total).toBe(status === 'finished' ? 1 : 0);
  await db.reads.delete(book.id);
  expect((await entries())[0].status).toBe('finished');
});

it('rejects invalid dates and stale source evidence', async () => {
  await db.events.add(event('one', 30)); await prepareSpotifyBooks(db);
  const book = spotifyBooks(await db.events.toArray())[0];
  await expect(confirmSpotifyBook(db, book, 'finished', '2026-02-30', '2026-01-01')).rejects.toThrow('valid');
  await expect(confirmSpotifyBook(db, book, 'finished', '2026-01-01', '2026-01-02')).rejects.toThrow('valid');
  await db.events.clear();
  await expect(confirmSpotifyBook(db, book, 'not-read', '', '')).rejects.toThrow('removed');
});
