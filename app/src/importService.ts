import type { Importer, RawEvent } from '@importers/types';
import { type BookendDB, type Edition, type ImportBatch, type ReadingEvent, type Work, newId } from './db';

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ImportOutcome {
  batch: ImportBatch;
  warnings: string[];
}

/** Returns an earlier batch with identical file content, if any. */
export async function findDuplicateBatch(db: BookendDB, text: string): Promise<ImportBatch | undefined> {
  return db.importBatches.where('contentHash').equals(await sha256(text)).first();
}

/** Parse a file with the given importer and store its events as one ImportBatch. */
export async function importFile(db: BookendDB, importer: Importer, text: string, fileName: string): Promise<ImportOutcome> {
  const { events, warnings } = importer.parse(text, fileName); // throws ImportError on unusable files
  const batch: ImportBatch = {
    id: newId(),
    source: importer.source,
    fileName,
    importedAt: new Date().toISOString(),
    eventCount: events.length,
    contentHash: await sha256(text),
  };
  await storeBatch(db, batch, events);
  return { batch, warnings };
}

async function storeBatch(db: BookendDB, batch: ImportBatch, events: (RawEvent & { editionId?: string | null })[]) {
  const rows: ReadingEvent[] = events.map((e) => ({ ...e, id: newId(), batchId: batch.id, editionId: e.editionId ?? null }));
  await db.transaction('rw', db.importBatches, db.events, async () => {
    await db.importBatches.add(batch);
    await db.events.bulkAdd(rows);
  });
}

/** Undo an import: removes the batch and every event it produced. */
export async function undoBatch(db: BookendDB, batchId: string): Promise<void> {
  await db.transaction('rw', db.importBatches, db.events, db.reads, async () => {
    const removed = new Set(await db.events.where('batchId').equals(batchId).primaryKeys());
    const affected = await db.reads.filter((read) => read.batchId === batchId || (read.eventIds?.some((id) => removed.has(id)) ?? false)).primaryKeys();
    await db.reads.bulkDelete(affected);
    await db.events.where('batchId').equals(batchId).delete();
    await db.importBatches.delete(batchId);
  });
}

// ---------------------------------------------------------------------------
// Paper books
// ---------------------------------------------------------------------------

export interface PaperBookInput {
  title: string;
  authors: string[];
  openLibraryWorkId?: string;
  openLibraryEditionId?: string;
  isbn?: string;
  pages?: number;
  pagesSource?: Edition['pagesSource'];
  coverUrl?: string;
  genres?: string[];
  openLibrarySubjects?: string[];
  /** ISO dates (yyyy-mm-dd or full ISO). */
  startedAt?: string;
  finishedAt?: string;
}

const toIso = (d: string) => (d.length === 10 ? new Date(d + 'T12:00:00').toISOString() : new Date(d).toISOString());

/**
 * Add a paper book: finds or creates its Work and Edition, then records its
 * start/finish dates as events in a new 'paper' batch (so the entry can be undone).
 */
export async function addPaperBook(db: BookendDB, input: PaperBookInput): Promise<{ work: Work; edition: Edition; batch: ImportBatch }> {
  return db.transaction('rw', [db.works, db.editions, db.events, db.importBatches], async () => {
    let work = input.openLibraryWorkId
      ? await db.works.where('openLibraryWorkId').equals(input.openLibraryWorkId).first()
      : undefined;
    if (!work) {
      work = {
        id: newId(),
        openLibraryWorkId: input.openLibraryWorkId,
        title: input.title,
        authors: input.authors,
        genres: input.genres ?? [],
        openLibrarySubjects: input.openLibrarySubjects,
        metadataReviewedAt: input.openLibraryWorkId || input.openLibraryEditionId ? new Date().toISOString() : undefined,
        coverUrl: input.coverUrl,
      };
      await db.works.add(work);
    }
    if (!work.metadataReviewedAt && (input.openLibraryWorkId || input.openLibraryEditionId)) {
      work = { ...work, metadataReviewedAt: new Date().toISOString() };
      await db.works.update(work.id, { metadataReviewedAt: work.metadataReviewedAt });
    }

    let edition = input.isbn
      ? await db.editions.where('isbn').equals(input.isbn).and((e) => e.format === 'paper').first()
      : undefined;
    if (!edition) {
      edition = {
        id: newId(),
        workId: work.id,
        format: 'paper',
        isbn: input.isbn,
        openLibraryEditionId: input.openLibraryEditionId,
        pages: input.pages,
        pagesSource: input.pagesSource,
      };
      await db.editions.add(edition);
    }

    const base = {
      source: 'paper' as const,
      rawTitle: input.title,
      rawAuthor: input.authors.join(', '),
      format: 'paper' as const,
      isbn: input.isbn,
      editionId: edition.id,
    };
    const events: (RawEvent & { editionId: string })[] = [];
    if (input.startedAt) events.push({ ...base, type: 'started', timestamp: toIso(input.startedAt) });
    if (input.finishedAt) events.push({ ...base, type: 'finished', timestamp: toIso(input.finishedAt), value: input.pages });

    const batch: ImportBatch = {
      id: newId(),
      source: 'paper',
      fileName: `Manual entry: ${input.title}`,
      importedAt: new Date().toISOString(),
      eventCount: events.length,
      editionId: edition.id,
    };
    await db.importBatches.add(batch);
    if (events.length) {
      await db.events.bulkAdd(events.map((e) => ({ ...e, id: newId(), batchId: batch.id })));
    }
    return { work, edition, batch };
  });
}

/** Record a later start or finish date for a paper edition already in the library. */
export async function addPaperDate(db: BookendDB, editionId: string, type: 'started' | 'finished', date: string): Promise<ImportBatch> {
  const edition = await db.editions.get(editionId);
  if (!edition) throw new Error('Edition not found');
  const work = await db.works.get(edition.workId);
  const batch: ImportBatch = {
    id: newId(),
    source: 'paper',
    fileName: `Manual ${type} date: ${work?.title ?? 'book'}`,
    importedAt: new Date().toISOString(),
    eventCount: 1,
  };
  await storeBatch(db, batch, [
    {
      source: 'paper',
      type,
      rawTitle: work?.title ?? '',
      rawAuthor: work?.authors.join(', ') ?? '',
      timestamp: toIso(date),
      format: 'paper',
      isbn: edition.isbn,
      value: type === 'finished' ? edition.pages : undefined,
      editionId,
    },
  ]);
  return batch;
}

