import Dexie, { type EntityTable } from 'dexie';
import type { BookFormat, EventType, SourceId } from '@importers/types';

/** One book, independent of edition or format. */
export interface Work {
  id: string;
  openLibraryWorkId?: string;
  title: string;
  authors: string[];
  genres: string[];
  /** Catalogue subjects kept separately as a fallback for recorded genres. */
  openLibrarySubjects?: string[];
  coverUrl?: string;
  /** Confirmed 404s, excluded from automatic cover selection. */
  missingCoverUrls?: string[];
  /** Set by an explicit match choice, so absent catalogue metadata doesn't requeue it. */
  metadataReviewedAt?: string;
}

/** A specific format of a work. */
export interface Edition {
  id: string;
  workId: string;
  format: BookFormat;
  isbn?: string;
  asin?: string;
  openLibraryEditionId?: string;
  pages?: number;
  pagesSource?: 'open-library-edition' | 'open-library-median';
  durationMinutes?: number;
  durationSource?: 'open-library-edition' | 'open-library-work' | 'libby-catalogue' | 'manual';
  libbyTitleId?: string;
  libbyRuntimeCheckedAt?: string;
  metadataCheckedAt?: string;
  narrators?: string[];
}

/** One raw fact from an importer. Never edited or deleted after import (except by undoing its batch). */
export interface ReadingEvent {
  id: string;
  batchId: string;
  source: SourceId;
  rawTitle: string;
  rawAuthor: string;
  type: EventType;
  timestamp: string;
  value?: number;
  format?: BookFormat;
  genres?: string[];
  /** Full audiobook runtime supplied by an importer, in minutes. */
  durationMinutes?: number;
  isbn?: string;
  asin?: string;
  sourceItemId?: string;
  /** Set when the event is linked to a known edition (paper entries now; matching in phase 2). */
  editionId?: string | null;
  extra?: Record<string, string | number | boolean | undefined>;
}

/** One confirmed reading or reading-in-progress of a work. Paper finish events can also be derived on demand. */
export interface Read {
  id: string;
  workId: string;
  status: 'in-progress' | 'finished' | 'abandoned' | 'not-read';
  startedAt?: string;
  finishedAt?: string;
  formats: BookFormat[];
  genres?: string[];
  /** Full runtime used only when no listening time can be deduced. */
  durationMinutes?: number;
  minutesListened?: number;
  pagesRead?: number;
  /** Evidence explicitly confirmed for this read; also used when undoing imports. */
  eventIds?: string[];
  editionIds?: string[];
  /** Manual-entry provenance when there are no dated events to link. */
  batchId?: string;
}

/** One imported file, or one manual entry session for paper books. */
export interface ImportBatch {
  id: string;
  source: SourceId;
  fileName: string;
  importedAt: string;
  eventCount: number;
  /** Manual catalogue entry, including books with no reading dates. */
  editionId?: string;
  /** SHA-256 of the file text, used to warn about importing the same file twice. */
  contentHash?: string;
}

export class BookendDB extends Dexie {
  works!: EntityTable<Work, 'id'>;
  editions!: EntityTable<Edition, 'id'>;
  events!: EntityTable<ReadingEvent, 'id'>;
  reads!: EntityTable<Read, 'id'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;

  constructor(name = 'bookend') {
    super(name);
    this.version(1).stores({
      works: 'id, openLibraryWorkId, title',
      editions: 'id, workId, isbn, asin, format',
      events: 'id, batchId, source, type, timestamp, editionId, isbn, [source+sourceItemId]',
      reads: 'id, workId, status, finishedAt',
      importBatches: 'id, source, importedAt, contentHash',
    });
  }
}

export const db = new BookendDB();

export const newId = () => crypto.randomUUID();

