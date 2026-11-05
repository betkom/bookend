import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BookendDB } from '../db';
import { lookupLibbyRuntime } from '../libbyCatalogue';
import { buildRecap, loadRecapData, recapEntries } from './data';
import { enrichEdition } from './metadata';
import { buildCards, themes } from './cards';

let db: BookendDB;
beforeEach(() => { db = new BookendDB(`libby-runtime-${Math.random()}`); });
afterEach(async () => { await db.delete(); });
const catalogue = { id: '505740', type: { id: 'audiobook' }, formats: [
  { id: 'audiobook-overdrive', duration: '07:36:38' }, { id: 'audiobook-mp3', duration: '07:43:20' },
] };
const fetcher = (data: unknown = catalogue, status = 200) => vi.fn(async () => new Response(JSON.stringify(data), { status })) as unknown as typeof fetch;
const stats = async () => buildRecap(recapEntries(await loadRecapData(db)), { year: 2026 });
async function existingRead() {
  await db.works.add({ id: 'w', title: 'The Adventures of Tom Sawyer', authors: ['Mark Twain'], genres: [] });
  await db.editions.add({ id: 'e', workId: 'w', format: 'audio', metadataCheckedAt: new Date().toISOString() });
  await db.events.add({ id: 'event', batchId: 'batch', source: 'libby', sourceItemId: '505740', type: 'borrowed', format: 'audio',
    rawTitle: 'The Adventures of Tom Sawyer', rawAuthor: 'Mark Twain', timestamp: '2026-01-01' });
  await db.reads.add({ id: 'r', workId: 'w', editionIds: ['e'], eventIds: ['event'], status: 'finished', formats: ['audio'], finishedAt: '2026-01-10' });
}

it('uses the Libby listening format runtime, including seconds, and deduplicates requests', async () => {
  const fetchFn = fetcher();
  expect(await lookupLibbyRuntime('505740', fetchFn)).toBeCloseTo(456 + 38 / 60);
  expect(await lookupLibbyRuntime('505740', fetchFn)).toBeCloseTo(456 + 38 / 60);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(fetchFn).toHaveBeenCalledWith('https://thunder.api.overdrive.com/v2/media/505740', expect.objectContaining({ credentials: 'omit' }));
});

it.each([
  { ...catalogue, id: 'another' }, { ...catalogue, type: { id: 'ebook' } },
  { ...catalogue, formats: [{ id: 'audiobook-overdrive', duration: '14 days' }] },
  { ...catalogue, formats: [{ id: 'audiobook-mp3', duration: '03:00:00' }, { id: 'audiobook-other', duration: '04:00:00' }] },
])('rejects wrong identities, formats, or invalid/ambiguous durations', async (data) => {
  expect(await lookupLibbyRuntime('505740', fetcher(data))).toBeUndefined();
});

it('rejects invalid IDs without making a request and retries network errors', async () => {
  const fetchFn = fetcher({}, 503);
  expect(await lookupLibbyRuntime('../anything', fetchFn)).toBeUndefined(); expect(fetchFn).not.toHaveBeenCalled();
  await expect(lookupLibbyRuntime('505740', fetchFn)).rejects.toThrow('503');
  await expect(lookupLibbyRuntime('505740', fetchFn)).rejects.toThrow('503');
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

it('backfills an existing read despite a recent Open Library check, labels the estimate, and caches it offline', async () => {
  await existingRead();
  const original = await db.events.toArray();
  const fetchFn = fetcher();
  expect(await enrichEdition(db, 'e', { fetchFn })).toMatchObject({ updated: true, matched: true });
  expect(await db.editions.get('e')).toMatchObject({ durationSource: 'libby-catalogue', libbyTitleId: '505740' });
  const recap = await stats();
  expect(recap).toMatchObject({ total: 1, minutes: 0, runtimeKnown: 1 });
  expect(recap.runtimeMinutes).toBeCloseTo(456 + 38 / 60);
  expect(buildCards(recap, themes[0]).find((card) => card.id === 'time')?.svg).toContain('audio hours · estimated');
  expect(await db.events.toArray()).toEqual(original);
  await enrichEdition(db, 'e', { fetchFn }); expect(fetchFn).toHaveBeenCalledTimes(1);
  await db.reads.update('r', { minutesListened: 100 });
  expect(await stats()).toMatchObject({ minutes: 100, runtimeMinutes: 0 });
});

it('replaces Open Library estimates with source runtime but preserves manual durations', async () => {
  await existingRead();
  await db.editions.update('e', { durationMinutes: 500, durationSource: 'open-library-edition' });
  await enrichEdition(db, 'e', { fetchFn: fetcher() });
  expect((await db.editions.get('e'))?.durationMinutes).toBeCloseTo(456 + 38 / 60);
  await db.editions.update('e', { durationMinutes: 700, durationSource: 'manual' });
  const fetchFn = fetcher(); await enrichEdition(db, 'e', { fetchFn });
  expect(fetchFn).not.toHaveBeenCalled(); expect((await db.editions.get('e'))?.durationMinutes).toBe(700);
});

it('does not turn missing runtime into zero listening hours', async () => {
  await existingRead(); await enrichEdition(db, 'e', { fetchFn: fetcher({}, 404) });
  const svg = buildCards(await stats(), themes[0]).find((card) => card.id === 'time')!.svg;
  expect(svg).toContain('Unknown'); expect(svg).toContain('audio hours unavailable');
});

it('discards a lookup if its import is removed while the request is in flight', async () => {
  await existingRead();
  const fetchFn = vi.fn(async () => { await db.events.clear(); await db.reads.clear(); return new Response(JSON.stringify(catalogue)); }) as unknown as typeof fetch;
  await enrichEdition(db, 'e', { fetchFn });
  expect((await db.editions.get('e'))?.durationMinutes).toBeUndefined();
});
