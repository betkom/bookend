import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookendDB, type Read } from '../db';
import { addPaperBook, addPaperDate, undoBatch } from '../importService';
import { exportBackup, restoreBackup } from '../backup';
import { libbyLoans } from '../loans';
import { buildRecap, confirmLoan, inPeriod, loadRecapData, missingBookDetails, recapEntries, recapGenre } from './data';
import { buildCards, escapeXml, themes } from './cards';

let db: BookendDB;
beforeEach(() => { db = new BookendDB(`recap-${Math.random()}`); });
afterEach(async () => { await db.delete(); });
const entries = async () => recapEntries(await loadRecapData(db));

it('assigns quarter and year boundaries consistently, including offset timestamps', () => {
  expect(inPeriod('2026-03-31T23:59:59Z', { year: 2026, quarter: 1 })).toBe(true);
  expect(inPeriod('2026-04-01T00:00:00Z', { year: 2026, quarter: 1 })).toBe(false);
  expect(inPeriod('2025-12-31T23:30:00-01:00', { year: 2026, quarter: 1 })).toBe(true);
  expect(inPeriod('2027-01-01', { year: 2026 })).toBe(false);
  expect(inPeriod('invalid', { year: 2026 })).toBe(false);
  expect(inPeriod(undefined, { year: 2026 })).toBe(false);
});

it('counts paper confirmations and re-reads, without reusing a previous start date', async () => {
  const first = await addPaperBook(db, { title: 'A book', authors: ['A'], pages: 300, openLibraryWorkId: 'OL1W', startedAt: '2026-01-01', finishedAt: '2026-01-10' });
  await addPaperDate(db, first.edition.id, 'finished', '2026-10-10');
  let reads = await entries();
  expect(reads).toHaveLength(2);
  expect(reads[1].startedAt).toBeUndefined();
  const stats = buildRecap(reads, { year: 2026 });
  expect(stats.total).toBe(2); expect(stats.pages).toBe(600); expect(stats.fastest?.days).toBe(9);
  expect(buildRecap(reads, { year: 2026, quarter: 1 }).total).toBe(1);
  await db.reads.put({ ...reads[0], id: 'explicit', eventIds: [reads[0].id] });
  reads = await entries(); expect(reads).toHaveLength(2);
  await undoBatch(db, first.batch.id);
  expect(await db.reads.count()).toBe(0);
  expect(await entries()).toHaveLength(1);
});

async function libbyLoan() {
  await db.importBatches.add({ id: 'batch', source: 'libby', fileName: 'timeline.csv', importedAt: '2026-06-01', eventCount: 2 });
  await db.events.bulkAdd([
    { id: 'borrow', batchId: 'batch', source: 'libby', rawTitle: 'Library book', rawAuthor: 'Author', type: 'borrowed', timestamp: '2026-01-01T12:00:00Z', format: 'audio', sourceItemId: '1' },
    { id: 'return', batchId: 'batch', source: 'libby', rawTitle: 'Library book', rawAuthor: 'Author', type: 'returned', timestamp: '2026-01-15T12:00:00Z', format: 'audio', sourceItemId: '1' },
  ]);
  return libbyLoans(await db.events.toArray())[0];
}

describe('Libby confirmation', () => {
  it('persists did-not-read without dates, excludes it from recaps, and allows changing the decision', async () => {
    const loan = await libbyLoan();
    await confirmLoan(db, loan, 'finished', '2026-01-14', '2026-01-02');
    await confirmLoan(db, loan, 'not-read', '', 'invalid');
    const backup = await exportBackup(db);
    await restoreBackup(db, JSON.stringify(backup));
    const reads = await db.reads.toArray();
    expect(reads).toHaveLength(1);
    expect(reads[0].status).toBe('not-read');
    expect(reads[0].startedAt).toBeUndefined();
    expect(reads[0].finishedAt).toBeUndefined();
    expect(reads[0].eventIds).toEqual(loan.eventIds);
    expect(buildRecap(await entries(), { year: 2026 })).toMatchObject({ total: 0, abandoned: 0, pages: 0, minutes: 0, sources: { libby: 0 } });
    // Older/imported records with a date must not be counted as abandoned either.
    await db.reads.update(reads[0].id, { finishedAt: '2026-01-14' });
    expect(buildRecap(await entries(), { year: 2026 }).abandoned).toBe(0);
    await confirmLoan(db, loan, 'abandoned', '2026-01-14');
    expect(buildRecap(await entries(), { year: 2026 }).abandoned).toBe(1);
    await confirmLoan(db, loan, 'not-read', '');
    await undoBatch(db, 'batch');
    expect(await db.reads.count()).toBe(0);
  });

  it('excludes automatic loan estimates; uses the confirmed date and persists edits once', async () => {
    const loan = await libbyLoan();
    expect(loan.status).toBe('finished');
    expect(await entries()).toHaveLength(0);
    await confirmLoan(db, loan, 'finished', '2026-04-01');
    let stats = buildRecap(await entries(), { year: 2026, quarter: 2 });
    expect(stats.total).toBe(1); expect(stats.sources.libby).toBe(1);
    expect(stats.minutes).toBe(0); expect(stats.minutesKnown).toBe(0);
    expect(stats.fastest).toBeUndefined(); // A borrow date is not a confirmed start date.
    await confirmLoan(db, loan, 'abandoned', '2026-04-02');
    expect(await db.reads.count()).toBe(1);
    expect(await db.editions.count()).toBe(1);
    stats = buildRecap(await entries(), { year: 2026 });
    expect(stats.total).toBe(0); expect(stats.abandoned).toBe(1); expect(stats.sources.libby).toBe(0);
  });
  it('round-trips evidence with backups, and removes confirmations when an import is undone', async () => {
    const loan = await libbyLoan(); await confirmLoan(db, loan, 'finished', '2026-01-14');
    const backup = await exportBackup(db); await restoreBackup(db, JSON.stringify(backup));
    expect(buildRecap(await entries(), { year: 2026 }).sources.libby).toBe(1);
    await undoBatch(db, 'batch'); expect(await entries()).toHaveLength(0);
  });
  it('rejects invalid dates and confirmations for removed evidence', async () => {
    const loan = await libbyLoan();
    await expect(confirmLoan(db, loan, 'finished', '2025-12-31')).rejects.toThrow(/after the borrow/);
    await expect(confirmLoan(db, loan, 'finished', 'bad')).rejects.toThrow(/valid finish date/);
    await expect(confirmLoan(db, loan, 'finished', '2026-02-30')).rejects.toThrow(/valid finish date/);
    await expect(confirmLoan(db, loan, 'finished', '2026-01-14', '2026-01-15')).rejects.toThrow(/start date/);
    await undoBatch(db, 'batch');
    await expect(confirmLoan(db, loan, 'finished', '2026-01-14')).rejects.toThrow(/removed/);
  });
});

it('counts mixed formats once overall and ranks genres and highlights', async () => {
  await db.works.add({ id: 'w', title: 'A & <book>', authors: [], genres: ['Fantasy fiction'] });
  await db.editions.bulkAdd([
    { id: 'paper', workId: 'w', format: 'paper', pages: 500 },
    { id: 'audio', workId: 'w', format: 'audio', narrators: ['One', 'Two'], durationMinutes: 1000 },
  ]);
  const read: Read = { id: 'r', workId: 'w', status: 'finished', formats: ['paper', 'audio'], startedAt: '2026-01-01', finishedAt: '2026-01-03', minutesListened: 120, editionIds: ['paper', 'audio'] };
  await db.reads.add(read);
  const stats = buildRecap(await entries(), { year: 2026 });
  expect(stats.total).toBe(1); expect(stats.formats).toEqual({ paper: 1, ebook: 0, audio: 1 });
  expect(stats.pages).toBe(500); expect(stats.minutes).toBe(120);
  expect(stats.genres).toEqual([['Fantasy', 1]]);
  expect(stats.longest?.pages).toBe(500); expect(stats.fastest?.days).toBe(2);
  expect(stats.busiest).toEqual(['2026-01', 1]);
  await db.events.add({ id: 'listen', batchId: 'b', source: 'libby', rawTitle: 'A book', rawAuthor: '', type: 'listened', timestamp: '2026-01-02', value: 45, editionId: 'audio' });
  await db.reads.update('r', { minutesListened: undefined, eventIds: ['listen'], finishedAt: '2025-12-31T23:30:00-01:00' });
  const fromEvents = buildRecap(await entries(), { year: 2026 });
  expect(fromEvents.minutes).toBe(45);
  expect(fromEvents.sources.libby).toBe(1);
  expect(fromEvents.busiest).toEqual(['2026-01', 1]);
});

it('maps specific genres before general fiction and retains unknown metadata', () => {
  expect(recapGenre(['Fiction', 'Science fiction'])).toBe('Science fiction');
  expect(recapGenre(['unmapped tag'])).toBe('Uncategorised');
});

it('renders every cover across pages, escapes user text and exports both themes at story dimensions', async () => {
  for (let i = 0; i < 13; i++) await addPaperBook(db, { title: `Book <${i}> & "title"`, authors: [], finishedAt: '2026-01-10' });
  const stats = buildRecap(await entries(), { year: 2026 });
  for (const theme of themes) {
    const cards = buildCards(stats, theme);
    expect(cards).toHaveLength(10);
    expect(cards.filter((c) => c.id.startsWith('covers-'))).toHaveLength(2);
    expect(cards.every((c) => c.svg.includes('width="1080" height="1920"'))).toBe(true);
    expect(cards.every((c) => !c.svg.includes('undefined') && !c.svg.includes('NaN'))).toBe(true);
    expect(cards.map((c) => c.svg).join('')).toContain('&lt;0&gt; &amp;');
  }
  expect(escapeXml('<script>"&')).toBe('&lt;script&gt;&quot;&amp;');
});

it('uses read, importer record, and work genres before the Open Library fallback', async () => {
  const loan = await libbyLoan();
  await confirmLoan(db, loan, 'finished', '2026-01-14');
  const [read] = await db.reads.toArray();
  await db.works.update(read.workId, { genres: ['Memoir'], openLibrarySubjects: ['Science fiction'] });
  await db.events.update('borrow', { genres: ['Fantasy'] });
  await db.reads.update(read.id, { genres: ['Poetry'] });
  const genre = async () => buildRecap(await entries(), { year: 2026 }).genres;
  expect(await genre()).toEqual([['Poetry', 1]]);
  await db.reads.update(read.id, { genres: undefined });
  expect(await genre()).toEqual([['Fantasy', 1]]);
  await db.events.update('borrow', { genres: undefined });
  expect(await genre()).toEqual([['Memoir & biography', 1]]);
  await db.works.update(read.workId, { genres: [] });
  expect(await genre()).toEqual([['Science fiction', 1]]);
  await db.reads.update(read.id, { genres: ['Cozy mystery'] });
  expect(await genre()).toEqual([['Cozy mystery', 1]]); // Don't replace an unmapped recorded genre.
  const backup = await exportBackup(db);
  await restoreBackup(db, JSON.stringify(backup));
  expect(await genre()).toEqual([['Cozy mystery', 1]]);
  await confirmLoan(db, loan, 'finished', '2026-01-15');
  expect(await genre()).toEqual([['Cozy mystery', 1]]); // Editing the review keeps its genre.
});

it.each(['libby', 'audible', 'spotify'] as const)('prefers measured listening and falls back to runtime for %s', async (source) => {
  await db.works.add({ id: 'w', title: 'Book', authors: [], genres: [] });
  await db.editions.add({ id: 'e', workId: 'w', format: 'audio', durationMinutes: 600, narrators: ['Narrator'] });
  await db.events.add({ id: 'event', batchId: 'batch', source, rawTitle: 'Book', rawAuthor: '', type: 'borrowed', timestamp: '2026-01-01', format: 'audio', durationMinutes: 480 });
  await db.reads.add({ id: 'r', workId: 'w', status: 'finished', formats: ['audio'], finishedAt: '2026-01-10', eventIds: ['event'], editionIds: ['e'] });
  const stats = async () => buildRecap(await entries(), { year: 2026 });
  expect(await stats()).toMatchObject({ minutes: 0, runtimeMinutes: 480, runtimeKnown: 1 });
  await db.events.add({ id: 'listen', batchId: 'batch', source, rawTitle: 'Book', rawAuthor: '', type: 'listened', timestamp: '2026-01-02', value: 90 });
  await db.reads.update('r', { eventIds: ['event', 'listen'] });
  expect(await stats()).toMatchObject({ minutes: 90, runtimeMinutes: 0, runtimeKnown: 0 });
  await db.reads.update('r', { minutesListened: 45 });
  expect(await stats()).toMatchObject({ minutes: 45, runtimeMinutes: 0 });
  await db.reads.update('r', { minutesListened: 0 });
  expect(await stats()).toMatchObject({ minutes: 0, minutesKnown: 1, runtimeMinutes: 0 });
  await db.reads.update('r', { minutesListened: undefined, eventIds: [] });
  expect(await stats()).toMatchObject({ runtimeMinutes: 600, runtimeKnown: 1 });
  await db.reads.update('r', { status: 'abandoned' });
  expect(await stats()).toMatchObject({ minutes: 0, runtimeMinutes: 0, runtimeKnown: 0 });
});

it('uses covers from existing linked Libby records before catalogue covers', async () => {
  const loan = await libbyLoan();
  await confirmLoan(db, loan, 'finished', '2026-01-14');
  const [read] = await db.reads.toArray();
  const libby = 'https://img1.od-cdn.com/ImageType-100/example.JPG';
  const openLibrary = 'https://covers.openlibrary.org/b/id/42-M.jpg';
  await db.events.update('borrow', { extra: { coverUrl: libby } });
  await db.works.update(read.workId, { coverUrl: openLibrary });
  let reads = await entries();
  expect(reads[0].coverUrls).toEqual([libby, openLibrary]);
  const card = buildCards(buildRecap(reads, { year: 2026 }), themes[0], { [libby]: 'data:image/jpeg;base64,YQ==', [openLibrary]: 'data:image/jpeg;base64,Yg==' }).find((c) => c.id === 'covers-1');
  expect(card?.svg).toContain('href="data:image/jpeg;base64,YQ=="');
  expect(card?.svg).not.toContain('href="data:image/jpeg;base64,Yg=="');
  await db.works.update(read.workId, { missingCoverUrls: [libby] });
  reads = await entries();
  expect(reads[0].coverUrls).toEqual([openLibrary]);
});

it('lists missing metadata rather than asking for details already recorded on a read', async () => {
  const loan = await libbyLoan(); await confirmLoan(db, loan, 'finished', '2026-01-14');
  const [read] = await db.reads.toArray();
  await db.reads.update(read.id, { minutesListened: 120, genres: ['Fantasy'] });
  await db.events.update('borrow', { extra: { coverUrl: 'https://img1.od-cdn.com/ImageType-100/example.JPG' } });
  expect(missingBookDetails((await entries())[0])).toEqual([]);
  await db.reads.update(read.id, { minutesListened: undefined });
  expect(missingBookDetails((await entries())[0])).toEqual(['audio runtime']);
});
