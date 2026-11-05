import type { BookFormat, SourceId } from '@importers/types';
import { type BookendDB, type Edition, type Read, type ReadingEvent, type Work, newId } from '../db';
import type { Loan } from '../loans';
import genreMap from './genres.json';
import { isCoverUrl, missingCover } from './coverUrls';
import { spotifyAutomaticReads } from './spotify';

export interface RecapData { works: Work[]; editions: Edition[]; events: ReadingEvent[]; reads: Read[] }
export interface RecapEntry extends Read { work: Work; editions: Edition[]; sources: SourceId[]; coverUrls?: string[] }
export interface Period { year: number; quarter?: number }
export const periodLabel = ({ year, quarter }: Period) => quarter ? `Q${quarter} ${year}` : `${year}`;

/** Calendar dates are interpreted consistently in UTC, including imported ISO timestamps. */
export function inPeriod(date: string | undefined, period: Period): boolean {
  if (!date) return false;
  const d = new Date(date);
  return d.getUTCFullYear() === period.year && (!period.quarter || Math.floor(d.getUTCMonth() / 3) + 1 === period.quarter);
}

export async function loadRecapData(db: BookendDB): Promise<RecapData> {
  return db.transaction('r', [db.works, db.editions, db.events, db.reads], async () => ({
    works: await db.works.toArray(), editions: await db.editions.toArray(),
    events: await db.events.toArray(), reads: await db.reads.toArray(),
  }));
}

/** Finish dates entered for paper books are already explicit confirmations. */
export function recapEntries(data: RecapData): RecapEntry[] {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const editions = new Map(data.editions.map((e) => [e.id, e]));
  const usedEvents = new Set(data.reads.flatMap((r) => r.eventIds ?? []));
  const reads = [...data.reads, ...spotifyAutomaticReads(data)];
  const paperEvents = data.events.filter((e) => e.source === 'paper').sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const starts = new Map<string, string>();
  for (const event of paperEvents) {
    if (!event.editionId) continue;
    if (event.type === 'started') starts.set(event.editionId, event.timestamp);
    if (event.type !== 'finished') continue;
    const edition = editions.get(event.editionId);
    const start = starts.get(event.editionId);
    starts.delete(event.editionId); // A re-read needs its own start date.
    if (!edition || usedEvents.has(event.id)) continue;
    if (reads.some((r) => r.workId === edition.workId && r.finishedAt === event.timestamp)) continue;
    reads.push({ id: event.id, workId: edition.workId, status: 'finished', finishedAt: event.timestamp,
      startedAt: start, formats: ['paper'], pagesRead: event.value ?? edition.pages,
      eventIds: [event.id], editionIds: [edition.id] });
  }
  return reads.flatMap((read) => {
    const work = works.get(read.workId);
    if (!work) return [];
    const linked = data.events.filter((e) => read.eventIds?.includes(e.id));
    const matched = data.editions.filter((e) => read.editionIds?.includes(e.id) || linked.some((event) => event.editionId === e.id));
    // Old backups may contain Reads without evidence links: only use unambiguous editions.
    if (!matched.length) {
      for (const format of read.formats) {
        const candidates = data.editions.filter((e) => e.workId === work.id && e.format === format);
        if (candidates.length === 1) matched.push(candidates[0]);
      }
    }
    const sources = [...new Set(linked.map((e) => e.source))];
    if (!sources.length && read.formats.includes('paper')) sources.push('paper');
    const listening = linked.filter((e) => e.type === 'listened' && nonnegative(e.value) !== undefined);
    const genres = recordedGenres(read.genres).length ? recordedGenres(read.genres) : recordedGenres(linked.flatMap((e) => e.genres ?? []));
    const durationMinutes = positive(read.durationMinutes) ?? linked.filter((e) => !e.format || e.format === 'audio').map((e) => positive(e.durationMinutes)).find((value) => value !== undefined);
    const coverUrls = [...new Set([...linked.filter((e) => e.source === 'libby').map((e) => e.extra?.coverUrl), work.coverUrl]
      .filter(isCoverUrl).filter((url) => !missingCover(url, work.missingCoverUrls)))];
    return [{ ...read, genres, durationMinutes, coverUrls, minutesListened: nonnegative(read.minutesListened) ?? (listening.length ? listening.reduce((sum, e) => sum + e.value!, 0) : undefined), work, editions: matched, sources }];
  });
}

const positive = (value?: number): number | undefined => value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;

const nonnegative = (value?: number): number | undefined => value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;

const recordedGenres = (genres?: string[]) => (genres ?? []).map((genre) => genre.trim()).filter(Boolean);

export function entryPages(entry: RecapEntry) {
  return positive(entry.pagesRead) ?? (entry.formats.some((f) => f === 'paper' || f === 'ebook')
    ? positive(entry.editions.find((e) => e.format !== 'audio' && positive(e.pages))?.pages) : undefined);
}

export function entryMinutes(entry: RecapEntry) {
  // A book's audio runtime isn't evidence of actual listening time.
  return nonnegative(entry.minutesListened);
}

export function entryRuntime(entry: RecapEntry) {
  if (!entry.formats.includes('audio')) return undefined;
  return positive(entry.durationMinutes) ?? positive(entry.editions.find((e) => e.format === 'audio' && positive(e.durationMinutes))?.durationMinutes);
}

/** Recorded read/import/work genres always win, even when absent from our mapping. */
export function entryGenre(entry: RecapEntry) {
  const recorded = recordedGenres(entry.genres).length ? recordedGenres(entry.genres) : recordedGenres(entry.work.genres);
  if (recorded.length) {
    const mapped = recapGenre(recorded);
    return mapped === 'Uncategorised' ? recorded[0] : mapped;
  }
  return recapGenre(entry.work.openLibrarySubjects ?? []);
}

export function missingBookDetails(entry: RecapEntry): string[] {
  const missing: string[] = [];
  if (!entry.coverUrls?.length) missing.push('cover');
  if (entryGenre(entry) === 'Uncategorised') missing.push('genre');
  if (entry.formats.some((format) => format !== 'audio') && entryPages(entry) === undefined) missing.push('page count');
  if (entry.formats.includes('audio') && entryMinutes(entry) === undefined && entryRuntime(entry) === undefined) missing.push('audio runtime');
  return missing;
}

export const needsBookMetadataReview = (entry: RecapEntry) => !entry.work.metadataReviewedAt && missingBookDetails(entry).length > 0;

export function recapGenre(genres: string[]) {
  const normalized = genres.map((g) => g.toLowerCase().trim());
  for (const [genre, tags] of Object.entries(genreMap)) {
    if (normalized.some((g) => tags.some((tag) => g === tag || g.startsWith(`${tag},`) || g.startsWith(`${tag} /`)
      || g.split(/\s*[,/]\s*/).includes(tag)))) return genre;
  }
  return 'Uncategorised';
}

/** Names keep their spelling for display; case/spacing differences share an identity. */
const identityKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

function entryAuthors(entry: RecapEntry) {
  const names = new Map<string, string>();
  for (const raw of entry.work.authors) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const key = identityKey(name);
    if (key && !['unknown', 'unknown author', 'not recorded'].includes(key) && !names.has(key)) names.set(key, name);
  }
  return names;
}

export function buildRecap(entries: RecapEntry[], period: Period) {
  const selected = entries.filter((e) => inPeriod(e.finishedAt, period));
  const finished = selected.filter((e) => e.status === 'finished');
  const formats: Record<BookFormat, number> = { paper: 0, ebook: 0, audio: 0 };
  const sources: Record<SourceId, number> = { paper: 0, libby: 0, audible: 0, spotify: 0 };
  const genres = new Map<string, number>();
  const authors = new Map<string, { name: string; count: number }>();
  const knownGenres = new Map<string, string>();
  const periodStart = Date.UTC(period.year, period.quarter ? (period.quarter - 1) * 3 : 0, 1);
  const previous = entries.filter((entry) => entry.status === 'finished' && entry.finishedAt && Date.parse(entry.finishedAt) < periodStart);
  const previousAuthors = new Set(previous.flatMap((entry) => [...entryAuthors(entry).keys()]));
  const previousGenres = new Set(previous.map(entryGenre).map(identityKey));
  const months = new Map<string, number>();
  let longest: { title: string; pages: number } | undefined;
  let fastest: { title: string; days: number } | undefined;
  for (const entry of finished) {
    for (const format of new Set(entry.formats)) formats[format]++;
    for (const source of entry.sources) sources[source]++;
    for (const [key, name] of entryAuthors(entry)) {
      const current = authors.get(key);
      authors.set(key, { name: current?.name ?? name, count: (current?.count ?? 0) + 1 });
    }
    const genre = entryGenre(entry);
    if (identityKey(genre) !== 'uncategorised') knownGenres.set(identityKey(genre), genre);
    genres.set(genre, (genres.get(genre) ?? 0) + 1);
    const month = new Date(entry.finishedAt!).toISOString().slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + 1);
    const pages = entryPages(entry);
    if (pages && (!longest || pages > longest.pages)) longest = { title: entry.work.title, pages };
    const days = entry.startedAt ? (Date.parse(entry.finishedAt!) - Date.parse(entry.startedAt)) / 86400000 : undefined;
    if (days !== undefined && days >= 0 && (!fastest || days < fastest.days)) fastest = { title: entry.work.title, days };

  }
  const ranked = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { period, finished, total: finished.length, abandoned: selected.filter((e) => e.status === 'abandoned').length, formats, sources,
    pages: finished.reduce((sum, e) => sum + (entryPages(e) ?? 0), 0),
    minutes: finished.reduce((sum, e) => sum + (entryMinutes(e) ?? 0), 0),
    runtimeMinutes: finished.reduce((sum, e) => sum + (entryMinutes(e) === undefined ? entryRuntime(e) ?? 0 : 0), 0),
    runtimeKnown: finished.filter((e) => entryMinutes(e) === undefined && entryRuntime(e) !== undefined).length,
    estimatedPages: finished.filter((e) => entryPages(e) !== undefined && e.editions.some((ed) => ed.pagesSource === 'open-library-median' && ed.pages === entryPages(e))).length,
    pagesKnown: finished.filter((e) => entryPages(e) !== undefined).length,
    minutesKnown: finished.filter((e) => entryMinutes(e) !== undefined).length,
    genres: ranked(genres), authors: ranked(new Map([...authors.values()].map(({ name, count }) => [name, count]))),
    uniqueAuthors: authors.size,
    newAuthors: [...authors].filter(([key]) => !previousAuthors.has(key)).map(([, author]) => author.name).sort((a, b) => a.localeCompare(b)),
    uniqueGenres: knownGenres.size,
    newGenres: [...knownGenres].filter(([key]) => !previousGenres.has(key)).map(([, name]) => name).sort((a, b) => a.localeCompare(b)),
    longest, fastest, busiest: ranked(months)[0],
  };
}
export type RecapStats = ReturnType<typeof buildRecap>;

export const loanReadId = (loan: Loan) => `libby:${loan.eventIds[0]}`;

/** The reader supplies an actual finish date; a return date alone never confirms a read. */
export async function confirmLoan(db: BookendDB, loan: Loan, status: Read['status'], date: string, startedAt?: string): Promise<void> {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const wasRead = status !== 'not-read';
  if (wasRead && !validDate(date)) throw new Error('Choose a valid finish date.');
  if (wasRead && startedAt && (!validDate(startedAt) || startedAt > date)) throw new Error('Choose a start date on or before the finish date.');
  if (!loan.eventIds.length) throw new Error('This loan has no source evidence.');
  if (wasRead && loan.borrowedAt && date < loan.borrowedAt.slice(0, 10)) throw new Error('The finish date must be on or after the borrow date.');
  await db.transaction('rw', [db.works, db.editions, db.events, db.reads], async () => {
    const events = await db.events.bulkGet(loan.eventIds);
    if (events.some((e) => !e)) throw new Error('This import was removed. Reload the recap.');
    const previous = await db.reads.get(loanReadId(loan));
    const editionId = previous?.editionIds?.[0] ?? events.find((e) => e?.editionId)?.editionId;
    let edition = editionId ? await db.editions.get(editionId) : undefined;
    if (!edition && loan.isbn) edition = await db.editions.where('isbn').equals(loan.isbn).and((e) => e.format === (loan.format ?? 'ebook')).first();
    if (!edition) {
      // Only reuse exact metadata; ambiguous fuzzy matching remains a separate phase.
      const work = await db.works.filter((w) => w.title.toLowerCase() === loan.rawTitle.toLowerCase()
        && w.authors.join(', ').toLowerCase() === loan.rawAuthor.toLowerCase()).first();
      const workId = work?.id ?? newId();
      if (!work) await db.works.add({ id: workId, title: loan.rawTitle, authors: loan.rawAuthor ? [loan.rawAuthor] : [], genres: [] });
      edition = await db.editions.where('workId').equals(workId).and((e) => e.format === (loan.format ?? 'ebook') && e.isbn === loan.isbn).first();
      if (!edition) {
        edition = { id: newId(), workId, format: loan.format ?? 'ebook', isbn: loan.isbn };
        await db.editions.add(edition);
      }
    }
    await db.reads.put({ ...previous, id: loanReadId(loan), workId: edition.workId, status, startedAt: wasRead && startedAt ? `${startedAt}T12:00:00.000Z` : undefined,
      finishedAt: wasRead ? `${date}T12:00:00.000Z` : undefined, formats: [edition.format], editionIds: [edition.id], eventIds: loan.eventIds });
  });
}
