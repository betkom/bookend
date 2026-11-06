import type { BookendDB, Read } from './db';
import { loadReadsData, readingRecords } from './reads';
import { confirmLoan, loanReadId } from './recap/data';
import { reviewDates } from './recap/reviewDates';
import { confirmSpotifyBook, prepareSpotifyBooks, spotifyBooks } from './recap/spotify';

/** Review the current evidence, so an undone import cannot be revived by a stale form. */
export async function saveReadingReview(db: BookendDB, recordId: string, status: Read['status'], date: string, start: string): Promise<string> {
  const dates = reviewDates(status, date, start);
  return db.transaction('rw', [db.works, db.editions, db.events, db.reads, db.importBatches], async () => {
    const data = await loadReadsData(db);
    const item = readingRecords(data).find((item) => item.id === recordId);
    if (!item) throw new Error('This reading record was removed or changed. Reload the page.');
    if (item.loan && item.id === loanReadId(item.loan)) {
      await confirmLoan(db, item.loan, status, date, start || undefined);
      return loanReadId(item.loan);
    }
    const spotify = spotifyBooks(data.events).find((book) => book.id === item.id);
    if (spotify) {
      // Reads is usable before Recap has prepared the catalogue records.
      await prepareSpotifyBooks(db);
      await confirmSpotifyBook(db, spotify, status, date, start);
      return item.id;
    }
    const previous = data.reads.find((read) => read.id === item.id);
    const events = data.events.filter((event) => item.eventIds.includes(event.id));
    // Keep the original start as evidence even if the review changes its displayed date.
    const starts = data.events.filter((event) => event.source === 'paper' && event.type === 'started'
      && event.timestamp === item.startedAt && item.editions.some((edition) => edition.id === event.editionId));
    const eventIds = [...new Set([...item.eventIds, ...starts.map((event) => event.id)])];
    await db.reads.put({ ...previous, id: item.id, workId: item.work.id, ...dates,
      formats: item.formats, editionIds: item.editions.map((edition) => edition.id), eventIds, batchId: item.batchId,
      pagesRead: previous?.pagesRead ?? item.entry?.pagesRead ?? events.find((event) => event.type === 'finished')?.value,
      minutesListened: item.minutesListened, durationMinutes: previous?.durationMinutes ?? item.durationMinutes,
    });
    return item.id;
  });
}
