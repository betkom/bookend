import type { BookendDB, Edition, Read, ReadingEvent } from '../db';
import type { RecapData } from './data';

export interface SpotifyBook {
  id: string;
  title: string;
  events: ReadingEvent[];
  minutes: number;
  startedAt: string;
  lastPlayedAt: string;
  editionId: string;
}

/** One audiobook across the imported history, including overlapping export files. */
export function spotifyBooks(events: ReadingEvent[]): SpotifyBook[] {
  const groups = new Map<string, ReadingEvent[]>();
  for (const event of events) {
    if (event.source !== 'spotify' || event.type !== 'listened' || !Number.isFinite(event.value) || event.value! <= 0) continue;
    const key = event.sourceItemId || JSON.stringify([event.rawTitle, event.rawAuthor]);
    const group = groups.get(key) ?? [];
    group.push(event); groups.set(key, group);
  }
  return [...groups].map(([key, group]) => {
    group.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
    // Retain all evidence IDs, but count repeated exports of the same play only once.
    // Identical plays within one export retain their multiplicity.
    const plays = new Map<string, Map<string, number>>();
    for (const event of group) {
      const fingerprint = JSON.stringify([event.timestamp, event.value, event.extra?.chapterUri ?? event.extra?.chapterTitle]);
      const batches = plays.get(fingerprint) ?? new Map<string, number>();
      batches.set(event.batchId, (batches.get(event.batchId) ?? 0) + 1);
      plays.set(fingerprint, batches);
    }
    let minutes = 0;
    for (const [fingerprint, batches] of plays) minutes += JSON.parse(fingerprint)[1] * Math.max(...batches.values());
    const id = `spotify:${key}`;
    return { id, title: group[0].rawTitle, events: group, minutes, startedAt: group[0].timestamp,
      lastPlayedAt: group[group.length - 1].timestamp, editionId: `${id}:audio` };
  });
}

export function spotifyRead(data: RecapData, book: SpotifyBook) {
  return data.reads.find((read) => read.id === book.id || read.eventIds?.some((id) => book.events.some((event) => event.id === id)));
}

export function spotifyEdition(data: RecapData, book: SpotifyBook): Edition | undefined {
  const read = spotifyRead(data, book);
  return data.editions.find((edition) => read?.editionIds?.includes(edition.id))
    ?? data.editions.find((edition) => book.events.some((event) => event.editionId === edition.id))
    ?? data.editions.find((edition) => edition.id === book.editionId);
}

export function spotifyRuntime(data: RecapData, book: SpotifyBook) {
  const runtime = spotifyEdition(data, book)?.durationMinutes ?? book.events.find((event) => event.durationMinutes && event.durationMinutes > 0)?.durationMinutes;
  return runtime !== undefined && Number.isFinite(runtime) && runtime > 0 ? runtime : undefined;
}

export const spotifyFinished = (minutes: number, runtime?: number) => runtime !== undefined && Number.isFinite(runtime) && runtime > 0 && minutes > 0 && minutes >= runtime - 5;

/** Derived so a runtime lookup or removal of an import immediately updates the recap. Explicit choices win. */
export function spotifyAutomaticReads(data: RecapData): Read[] {
  return spotifyBooks(data.events).flatMap((book) => {
    const edition = spotifyEdition(data, book);
    if (spotifyRead(data, book) || !edition || !spotifyFinished(book.minutes, spotifyRuntime(data, book))) return [];
    return [{ id: book.id, workId: edition.workId, status: 'finished', formats: ['audio'], startedAt: book.startedAt,
      finishedAt: book.lastPlayedAt, minutesListened: book.minutes, eventIds: book.events.map((event) => event.id), editionIds: [edition.id] }];
  });
}

/** Prepare local catalogue records for runtime/ISBN lookup without modifying raw events. */
export async function prepareSpotifyBooks(db: BookendDB) {
  await db.transaction('rw', [db.events, db.reads, db.editions, db.works], async () => {
    const data = { events: await db.events.toArray(), reads: await db.reads.toArray(), editions: await db.editions.toArray(), works: await db.works.toArray() };
    for (const book of spotifyBooks(data.events)) {
      if (spotifyEdition(data, book)) continue;
      const workId = `${book.id}:work`;
      if (!await db.works.get(workId)) await db.works.add({ id: workId, title: book.title, authors: [], genres: [] });
      await db.editions.put({ id: book.editionId, workId, format: 'audio' });
    }
  });
}

export async function confirmSpotifyBook(db: BookendDB, book: SpotifyBook, status: Read['status'], date: string, startedAt: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (status !== 'not-read' && (!valid(date) || !valid(startedAt) || startedAt > date)) throw new Error('Choose valid start and finish dates, with the start on or before the finish.');
  await db.transaction('rw', [db.events, db.reads, db.editions, db.works], async () => {
    const events = await db.events.bulkGet(book.events.map((event) => event.id));
    if (events.some((event) => !event)) throw new Error('This import was removed. Reload the recap.');
    const data = { events: events as ReadingEvent[], reads: await db.reads.toArray(), editions: await db.editions.toArray(), works: await db.works.toArray() };
    const edition = spotifyEdition(data, book);
    if (!edition) throw new Error('Book details are still being prepared. Try again.');
    const previous = spotifyRead(data, book);
    await db.reads.put({ ...previous, id: previous?.id ?? book.id, workId: edition.workId, status, formats: ['audio'],
      startedAt: status === 'not-read' ? undefined : `${startedAt}T12:00:00.000Z`, finishedAt: status === 'not-read' ? undefined : `${date}T12:00:00.000Z`,
      minutesListened: book.minutes, eventIds: book.events.map((event) => event.id), editionIds: [edition.id] });
  });
}
