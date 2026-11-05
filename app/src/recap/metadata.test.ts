import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BookendDB } from '../db';
import { addPaperBook } from '../importService';
import { buildRecap, loadRecapData, needsBookMetadataReview, recapEntries } from './data';
import { applyBookMetadataMatch, chooseBookMetadata, enrichEdition, findBookMetadata, keepBookMetadataMatch, repairBookCover, selectMetadataMatch } from './metadata';
import { exportBackup, restoreBackup } from '../backup';
import { buildCards, themes } from './cards';

let db: BookendDB;
beforeEach(() => { db = new BookendDB(`metadata-${Math.random()}`); });
afterEach(async () => { await db.delete(); });
const fakeFetch = (routes: Record<string, unknown>) => vi.fn(async (url: string | URL | Request) => {
  const body = routes[new URL(String(url)).pathname];
  return new Response(body === undefined ? '' : JSON.stringify(body), { status: body === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } });
}) as unknown as typeof fetch;

const stats = async () => buildRecap(recapEntries(await loadRecapData(db)), { year: 2026 });

it('backfills existing books with covers and labelled page estimates and persists them for offline use', async () => {
  const { work, edition } = await addPaperBook(db, { title: 'Test Book', authors: ['Ann Author'], finishedAt: '2026-01-01' });
  const fetchFn = fakeFetch({ '/search.json': { docs: [{ key: '/works/OL1W', title: 'Test Book', author_name: ['Ann Author'], cover_i: 42, number_of_pages_median: 320, subject: ['Fiction / Fantasy / Epic'] }] } });
  expect(await enrichEdition(db, edition.id, { fetchFn })).toMatchObject({ updated: true, matched: true });
  expect(await db.works.get(work.id)).toMatchObject({ coverUrl: 'https://covers.openlibrary.org/b/id/42-M.jpg', genres: [], openLibrarySubjects: ['Fiction / Fantasy / Epic'] });
  expect(await db.editions.get(edition.id)).toMatchObject({ pages: 320, pagesSource: 'open-library-median' });
  const recap = await stats();
  expect(recap.pages).toBe(320); expect(recap.estimatedPages).toBe(1);
  expect(recap.genres).toEqual([['Fantasy', 1]]);
  const cards = buildCards(recap, themes[0], { 'https://covers.openlibrary.org/b/id/42-M.jpg': 'data:image/jpeg;base64,YQ==' });
  expect(cards.find((c) => c.id === 'covers-1')?.svg).toContain('<image');
  expect(cards.find((c) => c.id === 'pages')?.svg).toContain('pages read · estimated');
  await enrichEdition(db, edition.id, { fetchFn });
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it('does not choose an ambiguous title or another author', () => {
  const work = { id: 'w', title: 'Test Book', authors: ['Ann'], genres: [] };
  expect(selectMetadataMatch(work, [{ title: 'Test Book', authors: ['Other'] }])).toBeUndefined();
  expect(selectMetadataMatch(work, [{ title: 'Test Book', authors: ['Ann'], openLibraryWorkId: 'OL1W' }, { title: 'Test Book', authors: ['Ann'], openLibraryWorkId: 'OL2W' }])).toBeUndefined();
});

it('preserves manual pages and existing covers when enriching a book', async () => {
  const { edition, work } = await addPaperBook(db, { title: 'Test', authors: [], pages: 250, coverUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg', isbn: '9780141439518', finishedAt: '2026-01-01' });
  await enrichEdition(db, edition.id, { fetchFn: fakeFetch({ '/isbn/9780141439518.json': { key: '/books/OL1M', title: 'Test', number_of_pages: 400, covers: [42] } }) });
  expect((await db.editions.get(edition.id))?.pages).toBe(250);
  expect((await db.works.get(work.id))?.coverUrl).toContain('/1-M.jpg');
});

it('uses exact audiobook runtime as an estimate without turning it into measured listening', async () => {
  await db.works.add({ id: 'w', title: 'Scythe', authors: [], genres: [] });
  await db.editions.add({ id: 'e', workId: 'w', format: 'audio', isbn: '9781543643626' });
  await db.reads.add({ id: 'r', workId: 'w', status: 'finished', formats: ['audio'], finishedAt: '2026-01-01', editionIds: ['e'] });
  await enrichEdition(db, 'e', { fetchFn: fakeFetch({ '/isbn/9781543643626.json': { key: '/books/OL26968555M', title: 'Scythe', physical_format: 'Audio CD', pagination: '9 audio discs (10 hr., 36 min.)', number_of_pages: 36, covers: [42] } }) });
  const recap = await stats();
  expect(recap.minutes).toBe(0); expect(recap.runtimeMinutes).toBe(636); expect(recap.pages).toBe(0);
  expect(buildCards(recap, themes[0]).find((c) => c.id === 'time')?.svg).toContain('audio hours · estimated');
  await db.reads.update('r', { minutesListened: 500 });
  const measured = await stats();
  expect(measured.minutes).toBe(500); expect(measured.runtimeMinutes).toBe(0);
});

it('leaves failed lookups retryable and does not persist cancelled results', async () => {
  const { edition } = await addPaperBook(db, { title: 'Test', authors: [], finishedAt: '2026-01-01' });
  await expect(enrichEdition(db, edition.id, { fetchFn: (async () => { throw new Error('offline'); }) as typeof fetch })).rejects.toThrow('offline');
  expect((await db.editions.get(edition.id))?.metadataCheckedAt).toBeUndefined();
  await enrichEdition(db, edition.id, { cancelled: () => true });
  expect((await db.editions.get(edition.id))?.metadataCheckedAt).toBeUndefined();
});

it('can find audio hours by work when the reader has no ISBN, but never guesses between conflicting runtimes', async () => {
  await db.works.add({ id: 'w', title: 'Audio Book', authors: ['Ann'], genres: [] });
  await db.editions.add({ id: 'e', workId: 'w', format: 'audio' });
  const routes = {
    '/search.json': { docs: [{ key: '/works/OL7W', title: 'Audio Book', author_name: ['Ann'], cover_i: 42 }] },
    '/works/OL7W/editions.json': { size: 2, entries: [{ pagination: '10 audio discs (12 hr.)' }, { pagination: '1 audio file (720 minutes)' }] },
  };
  await enrichEdition(db, 'e', { fetchFn: fakeFetch(routes) });
  expect(await db.editions.get('e')).toMatchObject({ durationMinutes: 720, durationSource: 'open-library-work' });
  await db.editions.update('e', { durationMinutes: undefined });
  await enrichEdition(db, 'e', { force: true, fetchFn: fakeFetch({ ...routes,
    '/works/OL7W/editions.json': { size: 2, entries: [{ pagination: '10 audio discs (12 hr.)' }, { pagination: '1 audio file (6 hours)' }] },
  }) });
  expect((await db.editions.get('e'))?.durationMinutes).toBeUndefined();
});

it('saves an explicitly chosen match and keeps a reader’s existing genre', async () => {
  const { edition, work } = await addPaperBook(db, { title: 'Ambiguous', authors: ['Ann'], genres: ['Memoir'], finishedAt: '2026-01-01' });
  await db.works.update(work.id, { openLibraryWorkId: 'OL99W', coverUrl: 'https://covers.openlibrary.org/b/id/99-M.jpg' });
  await chooseBookMetadata(db, edition.id, { title: 'Ambiguous', authors: ['Ann'], openLibraryWorkId: 'OL8W', coverUrl: 'https://covers.openlibrary.org/b/id/42-M.jpg', pages: 200, pagesSource: 'open-library-median', subjects: ['Fiction'] });
  expect(await db.works.get(work.id)).toMatchObject({ openLibraryWorkId: 'OL8W', genres: ['Memoir'], coverUrl: 'https://covers.openlibrary.org/b/id/42-M.jpg' });
  expect((await stats()).genres).toEqual([['Memoir & biography', 1]]);
  // Picking a work/cover does not claim an exact edition match.
  expect((await db.editions.get(edition.id))?.openLibraryEditionId).toBeUndefined();
});

it('replaces legacy guessed ISBN cover URLs when catalogue art is available', async () => {
  const { edition, work } = await addPaperBook(db, { title: 'Test Book', authors: ['Ann'], isbn: '9780739365885', finishedAt: '2026-01-01', coverUrl: 'https://covers.openlibrary.org/b/isbn/9780739365885-M.jpg?default=false' });
  await enrichEdition(db, edition.id, { fetchFn: fakeFetch({ '/search.json': { docs: [{ key: '/works/OL1W', title: 'Test Book', author_name: ['Ann'], cover_i: 42 }] } }) });
  expect((await db.works.get(work.id))?.coverUrl).toBe('https://covers.openlibrary.org/b/id/42-M.jpg');
});

it('does not fabricate an ISBN cover URL for an uncatalogued ISBN', async () => {
  const { edition, work } = await addPaperBook(db, { title: 'Unknown', authors: ['Unknown'], isbn: '9780739365885', finishedAt: '2026-01-01' });
  await enrichEdition(db, edition.id, { fetchFn: fakeFetch({ '/search.json': { docs: [] } }) });
  expect((await db.works.get(work.id))?.coverUrl).toBeUndefined();
});

it('repairs a confirmed 404 using another cover from the matched work', async () => {
  const missing = 'https://covers.openlibrary.org/b/id/42-M.jpg?default=false';
  await db.works.add({ id: 'w', title: 'Test', authors: [], genres: [], openLibraryWorkId: 'OL1W', coverUrl: missing });
  await repairBookCover(db, 'w', missing, fakeFetch({ '/works/OL1W.json': { covers: [42, 43] } }));
  expect(await db.works.get('w')).toMatchObject({ coverUrl: 'https://covers.openlibrary.org/b/id/43-M.jpg', missingCoverUrls: [missing] });
});

it('keeps a genuinely missing cover out of automatic retries and does not resurrect it on refresh', async () => {
  const missing = 'https://covers.openlibrary.org/b/isbn/9780739365885-M.jpg';
  const { work, edition } = await addPaperBook(db, { title: 'Test', authors: [], coverUrl: missing, finishedAt: '2026-01-01' });
  await repairBookCover(db, work.id, missing, fakeFetch({ '/search.json': { docs: [] } }));
  expect(await db.works.get(work.id)).toMatchObject({ missingCoverUrls: [missing] });
  expect((await db.works.get(work.id))?.coverUrl).toBeUndefined();
  await chooseBookMetadata(db, edition.id, { title: 'Test', authors: [], coverUrl: `${missing}?default=false` });
  expect((await db.works.get(work.id))?.coverUrl).toBeUndefined();
});

it('finds an exact ISBN edition first without making a title search', async () => {
  const work = { id: 'w', title: 'Book', authors: [], genres: [] };
  const editions = [{ id: 'e', workId: 'w', format: 'paper' as const, isbn: '0141439513' }];
  const fetchFn = fakeFetch({ '/isbn/9780141439518.json': { key: '/books/OL1M', title: 'Book', number_of_pages: 432 } });
  const matches = await findBookMetadata(work, editions, { fetchFn });
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ kind: 'isbn', editionId: 'e', candidate: { isbn: '9780141439518', openLibraryEditionId: 'OL1M', pages: 432, pagesSource: 'open-library-edition' } });
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it('allows a supplied ISBN and explains unknown ISBNs without silently returning a title match', async () => {
  const work = { id: 'w', title: 'Book', authors: [], genres: [] };
  const editions = [{ id: 'e', workId: 'w', format: 'paper' as const }];
  const fetchFn = fakeFetch({ '/search.json': { docs: [{ key: '/works/OL1W', title: 'Book' }] } });
  expect(await findBookMetadata(work, editions, { isbn: '9780739365885', editionId: 'e', fetchFn })).toEqual([]);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  const titleMatches = await findBookMetadata(work, editions, { titleOnly: true, fetchFn });
  expect(titleMatches[0].kind).toBe('title');
  await expect(findBookMetadata(work, editions, { isbn: '1234', editionId: 'e', fetchFn })).rejects.toThrow(/valid ISBN/);
});

it('falls back to title matching when imported ISBNs are not in the catalogue', async () => {
  const work = { id: 'w', title: 'Book', authors: [], genres: [] };
  const editions = [{ id: 'e', workId: 'w', format: 'paper' as const, isbn: '9780739365885' }];
  const fetchFn = fakeFetch({ '/search.json': { docs: [{ key: '/works/OL1W', title: 'Book', number_of_pages_median: 300 }] } });
  const matches = await findBookMetadata(work, editions, { fetchFn });
  expect(matches[0]).toMatchObject({ kind: 'title', candidate: { pages: 300, pagesSource: 'open-library-median' } });
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

it('applies exact audiobook details only to the selected edition and saves its ISBN for future lookups', async () => {
  await db.works.add({ id: 'w', title: 'Book', authors: [], genres: [] });
  const editions = [{ id: 'audio', workId: 'w', format: 'audio' as const, durationMinutes: 600, durationSource: 'open-library-work' as const },
    { id: 'paper', workId: 'w', format: 'paper' as const, pages: 300 }];
  await db.editions.bulkAdd(editions);
  const [match] = await findBookMetadata((await db.works.get('w'))!, editions, { isbn: '9781543643626', editionId: 'audio', fetchFn: fakeFetch({
    '/isbn/9781543643626.json': { key: '/books/OL26968555M', title: 'Book', physical_format: 'Audio CD', pagination: '9 audio discs (10 hr., 36 min.)' },
  }) });
  await applyBookMetadataMatch(db, editions, match);
  expect(await db.editions.get('audio')).toMatchObject({ isbn: '9781543643626', openLibraryEditionId: 'OL26968555M', durationMinutes: 636, durationSource: 'open-library-edition' });
  expect(await db.editions.get('paper')).toMatchObject({ pages: 300 });
  expect((await db.editions.get('paper'))?.isbn).toBeUndefined();
});

it('replaces a page median with an exact edition count while preserving manual page counts', async () => {
  const { edition } = await addPaperBook(db, { title: 'Book', authors: [], pages: 300, pagesSource: 'open-library-median', finishedAt: '2026-01-01' });
  const match = { kind: 'isbn' as const, editionId: edition.id, candidate: { title: 'Book', authors: [], isbn: '9780141439518', openLibraryEditionId: 'OL1M', pages: 432, pagesSource: 'open-library-edition' as const } };
  await applyBookMetadataMatch(db, [edition], match);
  expect(await db.editions.get(edition.id)).toMatchObject({ pages: 432, pagesSource: 'open-library-edition' });
  await db.editions.update(edition.id, { pages: 250, pagesSource: undefined });
  await applyBookMetadataMatch(db, [edition], match);
  expect((await db.editions.get(edition.id))?.pages).toBe(250);
});

it('keeps explicitly chosen books out of review even when optional metadata is still missing', async () => {
  const { edition } = await addPaperBook(db, { title: 'Book', authors: [], finishedAt: '2026-01-01' });
  const current = async () => recapEntries(await loadRecapData(db))[0];
  expect(needsBookMetadataReview(await current())).toBe(true);
  await chooseBookMetadata(db, edition.id, { title: 'Book', authors: [], openLibraryWorkId: 'OL1W' });
  expect((await current()).work.metadataReviewedAt).toBeTruthy();
  expect(needsBookMetadataReview(await current())).toBe(false);
  const backup = await exportBackup(db); await restoreBackup(db, JSON.stringify(backup));
  expect(needsBookMetadataReview(await current())).toBe(false);
});

it('allows keeping an existing match, while automatic enrichment alone does not dismiss review', async () => {
  const { edition, work } = await addPaperBook(db, { title: 'Book', authors: [], finishedAt: '2026-01-01' });
  await enrichEdition(db, edition.id, { fetchFn: fakeFetch({ '/search.json': { docs: [{ key: '/works/OL1W', title: 'Book' }] } }) });
  const current = async () => recapEntries(await loadRecapData(db))[0];
  expect(needsBookMetadataReview(await current())).toBe(true);
  await keepBookMetadataMatch(db, work.id);
  expect(needsBookMetadataReview(await current())).toBe(false);
});

it('fills missing author metadata for author recaps without overwriting recorded authors', async () => {
  const first = await addPaperBook(db, { title: 'Test', authors: [], finishedAt: '2026-01-01' });
  const match = { title: 'Test', authors: ['Catalogue Author'], openLibraryWorkId: 'OL1W' };
  await chooseBookMetadata(db, first.edition.id, match);
  expect((await db.works.get(first.work.id))?.authors).toEqual(['Catalogue Author']);
  expect((await stats()).authors).toEqual([['Catalogue Author', 1]]);
  await db.works.update(first.work.id, { authors: ['Recorded Author'] });
  await chooseBookMetadata(db, first.edition.id, match);
  expect((await db.works.get(first.work.id))?.authors).toEqual(['Recorded Author']);
});

it('backfills authors on previously matched books even when their metadata check is recent', async () => {
  const { work, edition } = await addPaperBook(db, { title: 'Matched Book', authors: [], finishedAt: '2026-01-01', openLibraryWorkId: 'OL1W' });
  await db.editions.update(edition.id, { metadataCheckedAt: new Date().toISOString() });
  await enrichEdition(db, edition.id, { fetchFn: fakeFetch({ '/search.json': { docs: [{ key: '/works/OL1W', title: 'Matched Book', author_name: ['Found Author'] }] } }) });
  expect((await db.works.get(work.id))?.authors).toEqual(['Found Author']);
  expect((await stats()).uniqueAuthors).toBe(1);
});
