import type { Read } from '../db';
import { db } from '../db';
import type { ReadingRecord, ReadsData } from '../reads';
import { saveReadingReview } from '../readReview';
import { ReadReviewForm } from '../recap/ReadReviewForm';
import { spotifyBooks } from '../recap/spotify';

export function ReadStatusReview({ item, data, onSaved, onReset }: {
  item: ReadingRecord; data: ReadsData; onSaved: (readId: string, title: string) => void; onReset: () => void;
}) {
  const read = data.reads.find((read) => read.id === item.id);
  const spotify = spotifyBooks(data.events).find((book) => book.id === item.id);
  const status: Read['status'] | undefined = read?.status
    ?? (item.status === 'in-progress' || item.status === 'finished' || item.status === 'abandoned' ? item.status : undefined);
  const date = (read?.finishedAt ?? item.endedAt ?? spotify?.lastPlayedAt ?? item.loan?.returnedAt ?? new Date().toISOString()).slice(0, 10);
  const start = (read?.startedAt ?? item.startedAt ?? '').slice(0, 10);
  return <div className="read-status-review">
    <h3>Review status</h3>
    <ReadReviewForm key={JSON.stringify([read?.status, read?.finishedAt, read?.startedAt])} status={status}
      initialDate={date} initialStart={start} startOptional={!spotify}
      onSave={async (status, date, start) => {
        const readId = await saveReadingReview(db, item.id, status, date, start);
        onSaved(readId, item.work.title);
      }}
      onReset={read ? async () => { await db.reads.delete(read.id); onReset(); } : undefined}
      resetLabel={spotify ? 'Use listening history instead' : 'Undo review'} />
  </div>;
}
