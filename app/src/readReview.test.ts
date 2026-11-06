import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookendDB, type ReadingEvent } from './db';
import { addPaperBook, addPaperDate, undoBatch } from './importService';
import { exportBackup, restoreBackup } from './backup';
import { loadReadsData, readingRecords } from './reads';
import { saveReadingReview } from './readReview';
import { buildRecap, recapEntries, confirmLoan } from './recap/data';
import { libbyLoans } from './loans';
import { confirmSpotifyBook, spotifyBooks } from './recap/spotify';

let db: BookendDB;
beforeEach(() => { db = new BookendDB(`review-${Math.random()}`); });
afterEach(async () => { await db.delete(); });
const records = async () => readingRecords(await loadReadsData(db));
const stats = async () => buildRecap(recapEntries(await loadReadsData(db)), { year: 2026 });
const event = (id: string, source: ReadingEvent['source'], type: ReadingEvent['type'], date: string, value?: number): ReadingEvent => ({
  id, source, type, timestamp: `${date}T12:00:00.000Z`, value,
  batchId: 'import', rawTitle: 'An imported book', rawAuthor: 'An author', sourceItemId: source, format: source === 'libby' ? 'ebook' : 'audio',
});

it.each([
  [undefined, undefined], ['2026-01-01', undefined], [undefined, '2026-01-10'], ['2026-01-01', '2026-01-10'],
])('reviews a manual book with start %s and finish %s without changing its raw history', async (startedAt, finishedAt) => {
  await addPaperBook(db, { title: 'Manual book', authors: [], pages: 100, startedAt, finishedAt });
  const item = (await records())[0];
  const raw = await db.events.toArray();
  const id = await saveReadingReview(db, item.id, 'finished', '2026-02-10', '2026-02-01');
  expect(id).toBe(item.id);
  expect((await records()).map((item) => item.status)).toEqual(['finished']);
  expect((await stats()).total).toBe(1);
  expect((await stats()).pages).toBe(100);
  expect((await records())[0].startedAt?.slice(0, 10)).toBe('2026-02-01');
  await saveReadingReview(db, id, 'abandoned', '2026-02-09', '');
  expect((await stats()).total).toBe(0);
  expect((await stats()).abandoned).toBe(1);
  await saveReadingReview(db, id, 'not-read', '', '');
  expect(await records()).toEqual([]);
  expect(await db.events.toArray()).toEqual(raw);
  await db.reads.delete(id);
  expect((await records())[0].status).toBe(finishedAt ? 'finished' : startedAt ? 'in-progress' : 'not-started');
});

it('keeps independent rereads when one manual read is reviewed', async () => {
  const { edition } = await addPaperBook(db, { title: 'Reread', authors: [], startedAt: '2026-01-01', finishedAt: '2026-01-02' });
  await addPaperDate(db, edition.id, 'started', '2026-02-01');
  await addPaperDate(db, edition.id, 'finished', '2026-02-10');
  const list = await records();
  await saveReadingReview(db, list[0].id, 'abandoned', '2026-02-08', '2026-02-01');
  expect((await records()).map((item) => item.status)).toEqual(['abandoned', 'finished']);
  expect((await stats()).total).toBe(1);
  expect((await stats()).abandoned).toBe(1);
});

it('preserves review provenance through backup and removes an undated review when its entry is undone', async () => {
  const { batch } = await addPaperBook(db, { title: 'Waiting', authors: [] });
  const id = await saveReadingReview(db, (await records())[0].id, 'finished', '2026-01-01', '');
  expect((await db.reads.get(id))?.batchId).toBe(batch.id);
  const backup = await exportBackup(db);
  await restoreBackup(db, JSON.stringify(backup));
  expect((await records())[0].status).toBe('finished');
  await undoBatch(db, batch.id);
  expect(await db.reads.count()).toBe(0);
  expect(await records()).toEqual([]);
});

it('removes a review when its dated manual evidence is undone', async () => {
  const { batch } = await addPaperBook(db, { title: 'Started', authors: [], startedAt: '2026-01-01' });
  await saveReadingReview(db, (await records())[0].id, 'finished', '2026-01-10', '2026-01-01');
  await undoBatch(db, batch.id);
  expect(await db.reads.count()).toBe(0);
  expect(await records()).toEqual([]);
});

it('does not revive a manual book from a stale form after undo', async () => {
  const { batch } = await addPaperBook(db, { title: 'Removed', authors: [] });
  const item = (await records())[0];
  await undoBatch(db, batch.id);
  await expect(saveReadingReview(db, item.id, 'finished', '2026-01-01', '')).rejects.toThrow(/removed or changed/);
  expect(await db.reads.count()).toBe(0);
});

it.each([
  ['2026-02-30', ''], ['invalid', ''], ['2026-01-01', '2026-01-02'], ['2026-01-01', 'invalid'],
])('rejects invalid review dates %s / %s without changing the book', async (date, start) => {
  await addPaperBook(db, { title: 'Validate', authors: [] });
  await expect(saveReadingReview(db, (await records())[0].id, 'finished', date, start)).rejects.toThrow(/valid|on or before/);
  expect(await db.reads.count()).toBe(0);
  expect((await records())[0].status).toBe('not-started');
});

describe('shared Libby and Spotify reviews', () => {
  it('uses Libby confirmation rules and shares subsequent changes with Recap', async () => {
    await db.events.add(event('loan', 'libby', 'borrowed', '2026-01-01'));
    const item = (await records())[0];
    await expect(saveReadingReview(db, item.id, 'finished', '2025-12-31', '')).rejects.toThrow(/borrow date/);
    const id = await saveReadingReview(db, item.id, 'finished', '2026-01-10', '2026-01-02');
    expect(await db.reads.count()).toBe(1);
    expect((await stats()).total).toBe(1);
    const loan = libbyLoans(await db.events.toArray())[0];
    await confirmLoan(db, loan, 'abandoned', '2026-01-09');
    expect((await records())[0].status).toBe('abandoned');
    await db.reads.delete(id);
    expect((await records())[0].status).toBe('in-progress');
    await saveReadingReview(db, item.id, 'not-read', '', '');
    expect(await records()).toEqual([]);
    await undoBatch(db, 'import');
    expect(await db.reads.count()).toBe(0);
  });

  it('reviews fresh Spotify imports without opening Recap and restores automatic completion on reset', async () => {
    await db.events.add(event('play', 'spotify', 'listened', '2026-01-10', 100));
    const item = (await records())[0];
    const id = await saveReadingReview(db, item.id, 'finished', '2026-01-10', '2026-01-01');
    expect(await db.editions.count()).toBe(1);
    expect(await db.reads.count()).toBe(1);
    expect((await stats()).minutes).toBe(100);
    const book = spotifyBooks(await db.events.toArray())[0];
    await confirmSpotifyBook(db, book, 'abandoned', '2026-01-09', '2026-01-01');
    expect((await records())[0].status).toBe('abandoned');
    await saveReadingReview(db, id, 'not-read', '', '');
    expect(await records()).toEqual([]);
    const edition = (await db.editions.toArray())[0];
    await db.editions.update(edition.id, { durationMinutes: 105 });
    await db.reads.delete(id);
    expect((await records())[0].status).toBe('finished');
    await saveReadingReview(db, id, 'abandoned', '2026-01-09', '2026-01-01');
    await undoBatch(db, 'import');
    expect(await db.reads.count()).toBe(0);
    expect(await records()).toEqual([]);
  });

  it('rejects an imported book whose evidence was removed while its form was open', async () => {
    await db.events.add(event('play', 'spotify', 'listened', '2026-01-10', 100));
    const item = (await records())[0];
    await undoBatch(db, 'import');
    await expect(saveReadingReview(db, item.id, 'finished', '2026-01-10', '2026-01-01')).rejects.toThrow(/removed or changed/);
    expect(await db.reads.count()).toBe(0);
    expect(await db.editions.count()).toBe(0);
  });
});

it('saves start-only reviews as in progress, completes them later, and can remove the finish date again', async () => {
  const { batch } = await addPaperBook(db, { title: 'Still reading', authors: [], pages: 100 });
  const item = (await records())[0];
  const id = await saveReadingReview(db, item.id, 'finished', '', '2026-01-01');
  expect((await db.reads.get(id))).toMatchObject({ status: 'in-progress', startedAt: '2026-01-01T12:00:00.000Z' });
  expect((await db.reads.get(id))?.finishedAt).toBeUndefined();
  expect((await records()).map((item) => item.status)).toEqual(['in-progress']);
  expect((await stats()).total).toBe(0);
  await saveReadingReview(db, id, 'finished', '2026-01-10', '2026-01-01');
  expect((await stats()).total).toBe(1);
  await saveReadingReview(db, id, 'in-progress', '', '2026-01-01');
  expect((await records())[0].endedAt).toBeUndefined();
  expect((await stats()).total).toBe(0);
  const backup = await exportBackup(db);
  await restoreBackup(db, JSON.stringify(backup));
  expect((await records())[0].status).toBe('in-progress');
  await undoBatch(db, batch.id);
  expect(await records()).toEqual([]);
  expect(await db.reads.count()).toBe(0);
});

it('keeps a completed manual book in progress when the reader clears its finish date', async () => {
  await addPaperBook(db, { title: 'Reconsidered', authors: [], startedAt: '2026-01-01', finishedAt: '2026-01-10' });
  const item = (await records())[0];
  const id = await saveReadingReview(db, item.id, 'finished', '', '2026-01-01');
  expect((await records()).map((item) => item.status)).toEqual(['in-progress']);
  expect((await stats()).total).toBe(0);
  await db.reads.delete(id);
  expect((await records())[0].status).toBe('finished');
});

it('shares start-only Libby reviews with Recap', async () => {
  await db.events.add(event('loan', 'libby', 'borrowed', '2026-01-01'));
  const item = (await records())[0];
  const id = await saveReadingReview(db, item.id, 'finished', '', '2026-01-02');
  expect((await records())[0].status).toBe('in-progress');
  expect((await db.reads.get(id))?.finishedAt).toBeUndefined();
  expect((await stats()).total).toBe(0);
  const loan = libbyLoans(await db.events.toArray())[0];
  await confirmLoan(db, loan, 'in-progress', '', '2026-01-03');
  expect((await records())[0].startedAt).toBe('2026-01-03T12:00:00.000Z');
  await confirmLoan(db, loan, 'finished', '2026-01-10', '2026-01-03');
  expect((await records())[0].status).toBe('finished');
});

it('lets explicit Spotify in-progress reviews override automatic completion until reset', async () => {
  await db.events.add(event('play', 'spotify', 'listened', '2026-01-10', 100));
  const item = (await records())[0];
  const id = await saveReadingReview(db, item.id, 'in-progress', '', '2026-01-01');
  const edition = (await db.editions.toArray())[0];
  await db.editions.update(edition.id, { durationMinutes: 105 });
  expect((await records())[0].status).toBe('in-progress');
  expect((await stats()).total).toBe(0);
  const book = spotifyBooks(await db.events.toArray())[0];
  await confirmSpotifyBook(db, book, 'finished', '', '2026-01-02');
  expect((await records())[0].status).toBe('in-progress');
  await db.reads.delete(id);
  expect((await records())[0].status).toBe('finished');
});

it.each(['', 'invalid', '2026-02-30'])('requires a valid start date for in-progress reviews: %s', async (start) => {
  await addPaperBook(db, { title: 'Validation', authors: [] });
  await expect(saveReadingReview(db, (await records())[0].id, 'in-progress', '', start)).rejects.toThrow(/valid start date/);
  expect(await db.reads.count()).toBe(0);
});
