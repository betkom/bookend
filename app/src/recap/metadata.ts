import type { BookCandidate } from '../openLibrary';
import { lookupAudioRuntime, lookupEdition, lookupEditionCovers, lookupIsbn, lookupWorkCovers, searchBooks } from '../openLibrary';
import { normaliseIsbn } from '../isbn';
import type { BookendDB, Edition, Work } from '../db';
import { missingCover } from './coverUrls';
import { enrichLibbyRuntime } from './libbyRuntime';

export const metadataTitle = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/\((?:unabridged|abridged|audiobook|audio book)\)/g, '')
  .split(/[:—]/)[0].replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const authorKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A title search must be unambiguous and agree with the author, when supplied. */
export function selectMetadataMatch(work: Work, candidates: BookCandidate[]): BookCandidate | undefined {
  if (work.openLibraryWorkId) {
    const known = candidates.find((candidate) => candidate.openLibraryWorkId === work.openLibraryWorkId);
    if (known) return known;
  }
  const matches = candidates.filter((candidate) => metadataTitle(candidate.title) === metadataTitle(work.title)
    && (!work.authors.length || work.authors.some((author) => candidate.authors.some((name) => authorKey(name) === authorKey(author)))));
  const works = new Map(matches.map((candidate) => [candidate.openLibraryWorkId ?? candidate.title, candidate]));
  return works.size === 1 ? [...works.values()][0] : undefined;
}

export interface MetadataResult { matched: boolean; updated: boolean; skipped: boolean }
export interface BookMetadataMatch {
  candidate: BookCandidate;
  /** An ISBN result belongs only to the edition searched, not every format of the work. */
  editionId?: string;
  kind: 'isbn' | 'title';
}

export async function findBookMetadata(work: Work, editions: Edition[], options: {
  isbn?: string; editionId?: string; titleOnly?: boolean; fetchFn?: typeof fetch;
} = {}): Promise<BookMetadataMatch[]> {
  if (!options.titleOnly) {
    const supplied = options.isbn !== undefined;
    const isbn = supplied ? normaliseIsbn(options.isbn!) : undefined;
    if (supplied && !isbn) throw new Error('Enter a valid ISBN-10 or ISBN-13.');
    if (supplied && !editions.some((edition) => edition.id === options.editionId)) throw new Error('Choose the format this ISBN belongs to.');
    const targets = supplied ? [{ isbn: isbn!, editionId: options.editionId! }]
      : editions.flatMap((edition) => {
        const clean = edition.isbn ? normaliseIsbn(edition.isbn) : null;
        return clean ? [{ isbn: clean, editionId: edition.id }] : [];
      });
    const matches: BookMetadataMatch[] = [];
    for (const target of targets) {
      const candidate = await lookupIsbn(target.isbn, options.fetchFn);
      if (candidate) matches.push({ candidate, editionId: target.editionId, kind: 'isbn' });
    }
    if (matches.length || supplied) return matches;
  }
  return (await searchBooks(metadataTitle(work.title), work.authors.join(' '), options.fetchFn))
    .map((candidate) => ({ candidate, kind: 'title' }));
}

export async function applyBookMetadataMatch(db: BookendDB, editions: Edition[], match: BookMetadataMatch): Promise<void> {
  const targets = match.kind === 'isbn' ? editions.filter((edition) => edition.id === match.editionId) : editions;
  if (!targets.length) throw new Error('This edition is no longer available.');
  for (const edition of targets) await chooseBookMetadata(db, edition.id, match.candidate, match.kind === 'isbn');
}

const validNumber = (value?: number) => value !== undefined && Number.isFinite(value) && value > 0;

/** Network work happens outside Dexie transactions; save only missing fields from a current record. */
export async function enrichEdition(db: BookendDB, editionId: string, options: {
  fetchFn?: typeof fetch; force?: boolean; cancelled?: () => boolean;
} = {}): Promise<MetadataResult> {
  const edition = await db.editions.get(editionId);
  const work = edition ? await db.works.get(edition.workId) : undefined;
  const skipped = { matched: false, updated: false, skipped: true };
  if (!edition || !work || options.cancelled?.()) return skipped;
  // Source runtimes are independent of the Open Library cache, including old imported reads.
  const runtimeUpdated = await enrichLibbyRuntime(db, edition, options).catch(() => false);
  const needsAuthor = !!work.openLibraryWorkId && !work.authors.some((name) => name.trim());
  if (!options.force && !needsAuthor && edition.metadataCheckedAt && Date.now() - Date.parse(edition.metadataCheckedAt) < 7 * 86400000) return runtimeUpdated ? { matched: true, updated: true, skipped: false } : skipped;
  const isbn = edition.isbn ? normaliseIsbn(edition.isbn) : null;
  let candidate = isbn ? await lookupIsbn(isbn, options.fetchFn) : null;
  let exactEdition = !!candidate;
  if (!candidate && edition.openLibraryEditionId) {
    candidate = await lookupEdition(edition.openLibraryEditionId, options.fetchFn);
    exactEdition = !!candidate;
  }
  const needsWorkDetails = (!work.coverUrl && !candidate?.coverUrl)
    || (!work.genres.some((genre) => genre.trim()) && !candidate?.subjects?.length)
    || (edition.format !== 'audio' && !validNumber(edition.pages) && !validNumber(candidate?.pages));
  if ((!candidate || needsWorkDetails) && !options.cancelled?.()) {
    try {
      const searchWork = { ...work, openLibraryWorkId: candidate?.openLibraryWorkId ?? work.openLibraryWorkId };
      const found = selectMetadataMatch(searchWork, await searchBooks(metadataTitle(work.title), work.authors.join(' '), options.fetchFn));
      if (found) candidate = candidate ? { ...candidate, coverUrl: candidate.coverUrl ?? found.coverUrl,
        subjects: candidate.subjects?.length ? candidate.subjects : found.subjects,
        pages: candidate.pages ?? found.pages, pagesSource: candidate.pages ? candidate.pagesSource : found.pagesSource } : found;
    } catch (error) { if (!candidate) throw error; }
  }
  const workId = candidate?.openLibraryWorkId ?? work.openLibraryWorkId;
  if (!runtimeUpdated && candidate && workId && edition.format === 'audio' && !validNumber(edition.durationMinutes) && !candidate.durationMinutes && !options.cancelled?.()) {
    const duration = await lookupAudioRuntime(workId, options.fetchFn).catch(() => undefined);
    if (duration) candidate = { ...candidate, durationMinutes: duration, durationSource: 'open-library-work' };
  }
  if (options.cancelled?.()) return skipped;
  const updated = await saveBookMetadata(db, editionId, candidate, exactEdition);
  return { matched: !!candidate || runtimeUpdated, updated: updated || runtimeUpdated, skipped: false };
}

/** Save an explicitly selected title/author match without treating its cover edition as exact. */
export async function chooseBookMetadata(db: BookendDB, editionId: string, candidate: BookCandidate, exactEdition = false): Promise<void> {
  const edition = await db.editions.get(editionId);
  if (edition?.format === 'audio' && candidate.openLibraryWorkId && !candidate.durationMinutes) {
    const duration = await lookupAudioRuntime(candidate.openLibraryWorkId).catch(() => undefined);
    if (duration) candidate = { ...candidate, durationMinutes: duration, durationSource: 'open-library-work' };
  }
  await saveBookMetadata(db, editionId, candidate, exactEdition, true);
}

async function saveBookMetadata(db: BookendDB, editionId: string, candidate: BookCandidate | null, exactEdition: boolean, chosen = false): Promise<boolean> {
  let updated = false;
  await db.transaction('rw', [db.works, db.editions], async () => {
    // Respect manual edits and import undo while a request was in flight.
    const currentEdition = await db.editions.get(editionId);
    const currentWork = currentEdition ? await db.works.get(currentEdition.workId) : undefined;
    if (!currentEdition || !currentWork) return;
    const workPatch: Partial<Work> = {};
    if (chosen) workPatch.metadataReviewedAt = new Date().toISOString();
    const editionPatch: Partial<Edition> = { metadataCheckedAt: new Date().toISOString() };
    if (candidate) {
      if (!currentWork.authors.some((name) => name.trim()) && candidate.authors.some((name) => name.trim())) workPatch.authors = candidate.authors.map((name) => name.trim()).filter(Boolean);
      const cover = [candidate.coverUrl, ...(candidate.coverUrls ?? [])].find((url): url is string => !!url && !missingCover(url, currentWork.missingCoverUrls));
      const provisional = currentWork.coverUrl?.startsWith('https://covers.openlibrary.org/b/isbn/');
      if ((!currentWork.coverUrl || provisional || chosen) && cover) workPatch.coverUrl = cover;
      if ((!currentWork.openLibraryWorkId || chosen) && candidate.openLibraryWorkId) workPatch.openLibraryWorkId = candidate.openLibraryWorkId;
      if (candidate.subjects?.length) workPatch.openLibrarySubjects = candidate.subjects;
      if (currentEdition.format !== 'audio' && (!validNumber(currentEdition.pages) || (exactEdition && currentEdition.pagesSource === 'open-library-median')) && validNumber(candidate.pages)) {
        editionPatch.pages = candidate.pages;
        editionPatch.pagesSource = candidate.pagesSource;
      }
      // Search medians/cover editions don't identify the audiobook the reader borrowed.
      if ((exactEdition || candidate.durationSource === 'open-library-work') && currentEdition.format === 'audio' && (!validNumber(currentEdition.durationMinutes) || (exactEdition && currentEdition.durationSource === 'open-library-work')) && validNumber(candidate.durationMinutes)) {
        editionPatch.durationMinutes = candidate.durationMinutes;
        editionPatch.durationSource = candidate.durationSource ?? 'open-library-edition';
      }
      if (exactEdition && (!currentEdition.openLibraryEditionId || chosen) && candidate.openLibraryEditionId) editionPatch.openLibraryEditionId = candidate.openLibraryEditionId;
      if (exactEdition && chosen && candidate.isbn) editionPatch.isbn = candidate.isbn;
    }
    updated = Object.keys(workPatch).length > 0 || Object.keys(editionPatch).length > 1;
    if (Object.keys(workPatch).length) await db.works.update(currentWork.id, workPatch);
    await db.editions.update(editionId, editionPatch);
  });
  return updated;
}

export async function keepBookMetadataMatch(db: BookendDB, workId: string): Promise<void> {
  const count = await db.works.update(workId, { metadataReviewedAt: new Date().toISOString() });
  if (!count) throw new Error('This book is no longer available.');
}

/** Repair only a confirmed missing cover; never discard one because the device is offline. */
export async function repairBookCover(db: BookendDB, workId: string, missingUrl: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const work = await db.works.get(workId);
  if (!work) return;
  const missing = [...new Set([...(work.missingCoverUrls ?? []), missingUrl])];
  if (work.coverUrl && work.coverUrl !== missingUrl) {
    await db.works.update(workId, { missingCoverUrls: missing });
    return; // The imported source image is missing; a catalogue cover may already be available.
  }
  // Remember the 404 before attempting another request, so opening Recap doesn't retry it forever.
  await db.works.update(workId, { missingCoverUrls: missing, coverUrl: undefined });
  let urls: string[] = [];
  try {
    if (work.openLibraryWorkId) urls = await lookupWorkCovers(work.openLibraryWorkId, fetchFn);
    if (!urls.some((url) => !missingCover(url, missing))) {
      const editions = await db.editions.where('workId').equals(workId).toArray();
      for (const edition of editions.filter((ed) => ed.openLibraryEditionId).slice(0, 3)) {
        urls.push(...await lookupEditionCovers(edition.openLibraryEditionId!, fetchFn));
        if (urls.some((url) => !missingCover(url, missing))) break;
      }
    }
    if (!urls.some((url) => !missingCover(url, missing))) {
      const match = selectMetadataMatch(work, await searchBooks(metadataTitle(work.title), work.authors.join(' '), fetchFn));
      if (match) urls.push(...[match.coverUrl, ...(match.coverUrls ?? [])].filter((url): url is string => !!url));
    }
  } catch { /* The missing-cover review remains available for a later retry. */ }
  await db.transaction('rw', db.works, async () => {
    const current = await db.works.get(workId);
    if (!current || current.coverUrl) return; // Don't overwrite a concurrent manual selection.
    const coverUrl = urls.find((url) => !missingCover(url, current.missingCoverUrls));
    if (coverUrl) await db.works.update(workId, { coverUrl });
  });
}
