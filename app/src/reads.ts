import type { BookFormat, SourceId } from '@importers/types';
import type { BookendDB, Edition, ImportBatch, ReadingEvent, Work } from './db';
import { libbyLoans, type Loan } from './loans';
import { loadRecapData, recapEntries, loanReadId, type RecapData, type RecapEntry } from './recap/data';
import { spotifyBooks, spotifyEdition, spotifyFinished, spotifyRead, spotifyRuntime } from './recap/spotify';
import { isCoverUrl, missingCover } from './recap/coverUrls';

export type ReadingStatus = 'not-started' | 'in-progress' | 'finished' | 'abandoned';
export const readingStatusLabels: Record<ReadingStatus, string> = {
  'not-started': 'Not started', 'in-progress': 'In progress', finished: 'Finished', abandoned: 'Abandoned',
};
export const sourceLabels: Record<SourceId, string> = { paper: 'Paper', libby: 'Libby', spotify: 'Spotify', audible: 'Audible' };
export const formatLabels: Record<BookFormat, string> = { paper: 'Paper', ebook: 'Ebook', audio: 'Audiobook' };
export interface ReadingRecord {
  id: string;
  work: Work;
  editions: Edition[];
  status: ReadingStatus;
  sources: SourceId[];
  formats: BookFormat[];
  startedAt?: string;
  endedAt?: string;
  activityAt?: string;
  coverUrls: string[];
  genres: string[];
  entry?: RecapEntry;
  minutesListened?: number;
  durationMinutes?: number;
  loan?: Loan;
}
export interface ReadsData extends RecapData { batches: ImportBatch[] }
export async function loadReadsData(db: BookendDB): Promise<ReadsData> {
  return db.transaction('r', [db.works, db.editions, db.events, db.reads, db.importBatches], async () => ({
    ...await loadRecapData(db), batches: await db.importBatches.toArray(),
  }));
}

function record(data: ReadsData, id: string, events: ReadingEvent[], edition?: Edition): ReadingRecord {
  const work = data.works.find((work) => work.id === edition?.workId) ?? {
    id, title: events[0]?.rawTitle ?? 'Untitled', authors: events[0]?.rawAuthor ? [events[0].rawAuthor] : [], genres: [],
  };
  const coverUrls = [...new Set([...events.filter((event) => event.source === 'libby').map((event) => event.extra?.coverUrl), work.coverUrl]
    .filter(isCoverUrl).filter((url) => !missingCover(url, work.missingCoverUrls)))];
  const genres = [...new Set(events.flatMap((event) => event.genres ?? []))];
  return { id, work, editions: edition ? [edition] : [], status: 'in-progress',
    sources: [...new Set(events.map((event) => event.source))], formats: [...new Set(events.flatMap((event) => event.format ? [event.format] : []))],
    coverUrls, genres: genres.length ? genres : work.genres,
    durationMinutes: events.find((event) => event.durationMinutes && event.durationMinutes > 0)?.durationMinutes,
  };
}

/** Presentation only: loan and partial-reading activity never changes recap completion. */
export function readingRecords(data: ReadsData): ReadingRecord[] {
  const entries = recapEntries(data);
  const result: ReadingRecord[] = entries.filter((entry) => entry.status !== 'not-read').map((entry) => ({
    id: entry.id, work: entry.work, editions: entry.editions, status: entry.status === 'abandoned' ? 'abandoned' : 'finished',
    sources: entry.sources, formats: entry.formats, startedAt: entry.startedAt, endedAt: entry.finishedAt,
    activityAt: entry.finishedAt ?? entry.startedAt, coverUrls: entry.coverUrls ?? [], genres: entry.genres?.length ? entry.genres : entry.work.genres,
    minutesListened: entry.minutesListened, entry,
  }));
  const usedEvents = new Set(entries.flatMap((entry) => entry.eventIds ?? []));
  const paper = data.events.filter((event) => event.source === 'paper' && event.editionId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || Number(b.type === 'started') - Number(a.type === 'started') || a.id.localeCompare(b.id));
  const pending = new Map<string, ReadingEvent>();
  for (const event of paper) {
    if (event.type === 'started') pending.set(event.editionId!, event);
    if (event.type === 'finished') pending.delete(event.editionId!);
  }
  for (const event of pending.values()) {
    if (usedEvents.has(event.id)) continue;
    const item = record(data, event.id, [event], data.editions.find((edition) => edition.id === event.editionId));
    result.push({ ...item, startedAt: event.timestamp, activityAt: event.timestamp });
  }
  for (const batch of data.batches.filter((batch) => batch.source === 'paper' && batch.eventCount === 0)) {
    let edition = batch.editionId ? data.editions.find((edition) => edition.id === batch.editionId) : undefined;
    if (!batch.editionId && batch.fileName.startsWith('Manual entry: ')) {
      const title = batch.fileName.slice('Manual entry: '.length);
      const candidates = data.editions.filter((edition) => edition.format === 'paper' && data.works.some((work) => work.id === edition.workId && work.title === title));
      if (candidates.length === 1) edition = candidates[0];
    }
    if (!edition || paper.some((event) => event.editionId === edition.id) || entries.some((entry) => entry.editions.some((ed) => ed.id === edition.id))) continue;
    if (result.some((item) => item.editions.some((ed) => ed.id === edition.id))) continue;
    const item = record(data, batch.id, [], edition);
    result.push({ ...item, status: 'not-started', sources: ['paper'], formats: ['paper'] });
  }
  for (const book of spotifyBooks(data.events)) {
    if (spotifyRead(data, book)) continue;
    if (book.events.some((event) => usedEvents.has(event.id))) continue;
    const edition = spotifyEdition(data, book);
    const complete = spotifyFinished(book.minutes, spotifyRuntime(data, book));
    const item = record(data, book.id, book.events, edition);
    result.push({ ...item, status: complete ? 'finished' : 'in-progress', startedAt: book.startedAt,
      endedAt: complete ? book.lastPlayedAt : undefined, activityAt: book.lastPlayedAt, minutesListened: book.minutes, formats: ['audio'] });
  }
  for (const loan of libbyLoans(data.events)) {
    const linked = data.events.filter((event) => loan.eventIds.includes(event.id));
    const existing = result.find((item) => item.id === loanReadId(loan) || item.entry?.eventIds?.some((id) => loan.eventIds.includes(id)));
    if (existing) {
      existing.loan = loan;
      if (!existing.sources.includes('libby')) existing.sources = [...existing.sources, 'libby'];
      continue;
    }
    if (loan.returnedAt || data.reads.some((read) => read.id === loanReadId(loan) || read.eventIds?.some((id) => loan.eventIds.includes(id)))) continue;
    const edition = data.editions.find((edition) => linked.some((event) => event.editionId === edition.id));
    const item = record(data, loanReadId(loan), linked, edition);
    result.push({ ...item, loan, activityAt: loan.borrowedAt });
  }
  return result.sort((a, b) => (b.activityAt ?? '').localeCompare(a.activityAt ?? '') || a.work.title.localeCompare(b.work.title) || a.id.localeCompare(b.id));
}

export function filterReadingRecords(records: ReadingRecord[], query: string, source: SourceId | 'all', status: ReadingStatus | 'all') {
  const term = query.trim().toLowerCase();
  return records.filter((item) => (source === 'all' || item.sources.includes(source)) && (status === 'all' || item.status === status)
    && (!term || `${item.work.title} ${item.work.authors.join(' ')}`.toLowerCase().includes(term)));
}
