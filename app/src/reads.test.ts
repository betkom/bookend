import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookendDB, type ReadingEvent } from './db';
import { addPaperBook, addPaperDate, undoBatch } from './importService';
import { exportBackup, restoreBackup } from './backup';
import { filterReadingRecords, loadReadsData, readingRecords } from './reads';
import { buildRecap, confirmLoan, recapEntries } from './recap/data';
import { libbyLoans } from './loans';
import { confirmSpotifyBook, prepareSpotifyBooks, spotifyBooks } from './recap/spotify';

let db: BookendDB;
beforeEach(() => { db = new BookendDB(`reads-${Math.random()}`); });
afterEach(async () => { await db.delete(); });
const records = async () => readingRecords(await loadReadsData(db));
const event = (id: string, source: ReadingEvent['source'], type: ReadingEvent['type'], timestamp: string, more: Partial<ReadingEvent> = {}): ReadingEvent => ({
  id, batchId: 'import', source, type, timestamp: `${timestamp}T12:00:00.000Z`, rawTitle: source === 'libby' ? 'Library book' : 'Audio book', rawAuthor: 'An Author',
  format: source === 'libby' ? 'ebook' : 'audio', sourceItemId: source, ...more,
});
async function addLoan(returned = false) {
  await db.events.bulkAdd([event('borrow', 'libby', 'borrowed', '2026-01-01'), event('renew', 'libby', 'renewed', '2026-01-02'),
    ...(returned ? [event('return', 'libby', 'returned', '2026-01-10')] : [])]);
  return libbyLoans(await db.events.toArray())[0];
}
async function addListening() {
  await db.events.bulkAdd([event('play1', 'spotify', 'listened', '2026-02-01', { value: 20 }), event('play2', 'spotify', 'listened', '2026-02-02', { value: 30 })]);
}

describe('manual reading records', () => {
  it.each([
    [undefined, undefined, 'not-started'], ['2026-01-01', undefined, 'in-progress'],
    [undefined, '2026-01-10', 'finished'], ['2026-01-01', '2026-01-10', 'finished'],
  ])('maps start %s and finish %s to %s', async (startedAt, finishedAt, status) => {
    const added = await addPaperBook(db, { title: 'Paper book', authors: ['Writer'], startedAt, finishedAt });
    expect(added.batch.editionId).toBe(added.edition.id);
    const list = await records();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status, work: { title: 'Paper book' }, sources: ['paper'], formats: ['paper'] });
    expect(list[0].startedAt?.slice(0, 10)).toBe(startedAt);
    expect(list[0].endedAt?.slice(0, 10)).toBe(finishedAt);
  });

  it('updates an undated entry with later dates and preserves rereads', async () => {
    const { edition } = await addPaperBook(db, { title: 'Again', authors: [] });
    await addPaperDate(db, edition.id, 'started', '2026-01-01');
    expect((await records()).map((item) => item.status)).toEqual(['in-progress']);
    await addPaperDate(db, edition.id, 'finished', '2026-01-10');
    await addPaperDate(db, edition.id, 'started', '2026-02-01');
    expect((await records()).map((item) => item.status)).toEqual(['in-progress', 'finished']);
    await addPaperDate(db, edition.id, 'finished', '2026-02-10');
    expect((await records()).map((item) => item.status)).toEqual(['finished', 'finished']);
    expect((await records()).map((item) => item.startedAt?.slice(0, 10))).toEqual(['2026-02-01', '2026-01-01']);
  });

  it('undo removes an undated record without deleting catalogue metadata', async () => {
    const { batch } = await addPaperBook(db, { title: 'Waiting', authors: [] });
    expect(await records()).toHaveLength(1);
    await undoBatch(db, batch.id);
    expect(await records()).toEqual([]);
    expect(await db.works.count()).toBe(1);
    expect(await db.editions.count()).toBe(1);
  });

  it('recovers only unambiguous legacy undated manual batches', async () => {
    const { batch } = await addPaperBook(db, { title: 'Legacy', authors: [] });
    await db.importBatches.put({ ...batch, editionId: undefined });
    expect((await records())[0].status).toBe('not-started');
    const backup = await exportBackup(db);
    await restoreBackup(db, JSON.stringify(backup));
    expect(await records()).toHaveLength(1);
    await addPaperBook(db, { title: 'Legacy', authors: ['Other writer'] });
    // Two equally named editions cannot safely recover the older batch.
    expect(await records()).toHaveLength(1);
  });

  it('round-trips the manual batch link through backup', async () => {
    const { edition, batch } = await addPaperBook(db, { title: 'Saved for later', authors: [] });
    const backup = await exportBackup(db);
    await db.importBatches.clear();
    await restoreBackup(db, JSON.stringify(backup));
    expect((await db.importBatches.get(batch.id))?.editionId).toBe(edition.id);
    expect((await records())[0].status).toBe('not-started');
  });
});

describe('imported reading records', () => {
  it('shows an open Libby loan once, with no invented reading dates', async () => {
    await addLoan();
    const list = await records();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'in-progress', sources: ['libby'], loan: { renewals: 1 } });
    expect(list[0].startedAt).toBeUndefined();
    expect(list[0].endedAt).toBeUndefined();
    expect(buildRecap(recapEntries(await loadReadsData(db)), { year: 2026 }).total).toBe(0);
  });

  it('never promotes a long returned loan without confirmation; explicit reviews win', async () => {
    const loan = await addLoan(true);
    expect(loan.status).toBe('finished');
    expect(await records()).toEqual([]);
    await confirmLoan(db, loan, 'finished', '2026-01-09');
    expect(await records()).toHaveLength(1);
    expect((await records())[0]).toMatchObject({ status: 'finished', sources: ['libby'], loan: { returnedAt: expect.any(String) } });
    await confirmLoan(db, loan, 'abandoned', '2026-01-08');
    expect((await records())[0].status).toBe('abandoned');
    await confirmLoan(db, loan, 'not-read', '');
    expect(await records()).toEqual([]);
  });

  it('does not duplicate or revive a reviewed open loan', async () => {
    const loan = await addLoan();
    await confirmLoan(db, loan, 'finished', '2026-01-03');
    expect((await records()).map((item) => item.status)).toEqual(['finished']);
    await confirmLoan(db, loan, 'not-read', '');
    expect(await records()).toEqual([]);
  });

  it('shows Spotify before catalogue preparation, then recomputes automatic completion', async () => {
    await addListening();
    let list = await records();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'in-progress', work: { title: 'Audio book' }, minutesListened: 50 });
    await prepareSpotifyBooks(db);
    expect((await records())[0].status).toBe('in-progress');
    const edition = (await db.editions.toArray())[0];
    await db.editions.update(edition.id, { durationMinutes: 55 });
    list = await records();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('finished');
    expect(list[0].endedAt?.slice(0, 10)).toBe('2026-02-02');
    const book = spotifyBooks(await db.events.toArray())[0];
    await confirmSpotifyBook(db, book, 'abandoned', '2026-02-02', '2026-02-01');
    expect((await records()).map((item) => item.status)).toEqual(['abandoned']);
    await confirmSpotifyBook(db, book, 'not-read', '', '');
    expect(await records()).toEqual([]);
    await db.reads.clear();
    await db.editions.update(edition.id, { durationMinutes: 100 });
    expect((await records())[0].status).toBe('in-progress');
    await undoBatch(db, 'import');
    expect(await records()).toEqual([]);
  });

  it('deduplicates Spotify activity from overlapping exports', async () => {
    await addListening();
    await db.events.add(event('duplicate', 'spotify', 'listened', '2026-02-01', { value: 20, batchId: 'other' }));
    expect(await records()).toHaveLength(1);
    expect((await records())[0].minutesListened).toBe(50);
  });
});

it('sorts dated records newest first and undated records alphabetically; filters title, author, source and status', async () => {
  await addPaperBook(db, { title: 'Zebra', authors: [] });
  await addPaperBook(db, { title: 'Apple', authors: ['Mary Writer'] });
  await addPaperBook(db, { title: 'Finished book', authors: [], finishedAt: '2026-01-01' });
  await addListening();
  await addLoan();
  const list = await records();
  expect(list.map((item) => item.work.title)).toEqual(['Audio book', 'Finished book', 'Library book', 'Apple', 'Zebra']);
  expect(filterReadingRecords(list, ' mary ', 'paper', 'not-started').map((item) => item.work.title)).toEqual(['Apple']);
  expect(filterReadingRecords(list, 'book', 'libby', 'in-progress')).toHaveLength(1);
  expect(filterReadingRecords(list, '', 'all', 'finished')).toHaveLength(1);
  expect(filterReadingRecords(list, 'missing', 'all', 'all')).toEqual([]);
  expect(buildRecap(recapEntries(await loadReadsData(db)), { year: 2026 }).total).toBe(1);
});

it('treats same-day manual start and finish as one finished reading, regardless of event ID order', async () => {
  const { edition } = await addPaperBook(db, { title: 'One day', authors: [] });
  const start = event('z-start', 'paper', 'started', '2026-01-01', { editionId: edition.id, format: 'paper' });
  const finish = event('a-finish', 'paper', 'finished', '2026-01-01', { editionId: edition.id, format: 'paper' });
  await db.events.bulkAdd([finish, start]);
  const list = await records();
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ status: 'finished', startedAt: start.timestamp, endedAt: finish.timestamp });
});

it('tags a legacy Libby review identified by its loan ID even without evidence links', async () => {
  const loan = await addLoan(true);
  await confirmLoan(db, loan, 'finished', '2026-01-09');
  const read = (await db.reads.toArray())[0];
  await db.reads.put({ ...read, eventIds: undefined });
  expect((await records())[0].sources).toContain('libby');
});
