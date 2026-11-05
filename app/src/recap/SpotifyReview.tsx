import { useState } from 'react';
import { db } from '../db';
import type { RecapData, RecapEntry } from './data';
import { BookMetadataReview } from './BookMetadataReview';
import { ReadReviewForm, readStatusLabel } from './ReadReviewForm';
import { confirmSpotifyBook, spotifyEdition, spotifyFinished, spotifyRead, spotifyRuntime, type SpotifyBook } from './spotify';

export function SpotifyReview({ book, data }: { book: SpotifyBook; data: RecapData }) {
  const read = spotifyRead(data, book);
  const edition = spotifyEdition(data, book);
  const work = data.works.find((work) => work.id === edition?.workId);
  const runtime = spotifyRuntime(data, book);
  const automatic = !read && spotifyFinished(book.minutes, runtime);
  const [runtimeInput, setRuntimeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const entry: RecapEntry | undefined = work && edition ? { id: book.id, workId: work.id, work, editions: [edition], sources: ['spotify'],
    status: 'finished', formats: ['audio'], minutesListened: book.minutes, coverUrls: work.coverUrl ? [work.coverUrl] : [] } : undefined;
  async function saveRuntime() {
    if (!edition) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const minutes = Number(runtimeInput);
      if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Enter the full audiobook runtime in minutes.');
      await db.editions.update(edition.id, { durationMinutes: minutes, durationSource: 'manual' });
      setRuntimeInput(''); setMessage('Runtime saved.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save runtime.'); }
    finally { setBusy(false); }
  }

  const time = (minutes: number) => `${Math.floor(Math.round(minutes) / 60)}h ${Math.round(minutes) % 60}m`;
  return <li className="recap-review-item"><details className="book-review">
    <summary><span className="review-heading"><strong>{work?.title ?? book.title}</strong>
      <span className="small muted">{time(book.minutes)} listened{runtime === undefined ? ' · Runtime missing' : ` of ${time(runtime)}`}</span>
      <span className="review-state">{read ? readStatusLabel[read.status] : automatic ? 'Finished · Based on listening' : 'Needs review'}</span>
    </span></summary>
    {!read && <p className="small muted">{automatic ? 'Counted in your recap. You can change the status or dates.' : runtime === undefined ? 'Add the audiobook runtime below, or choose a status.' : 'Listening time is below the finish threshold. Choose a status.'}</p>}
    <ReadReviewForm key={read?.status ?? (automatic ? 'automatic' : 'pending')} status={read?.status ?? (automatic ? 'finished' : undefined)}
      initialDate={(read?.finishedAt ?? book.lastPlayedAt).slice(0, 10)} initialStart={(read?.startedAt ?? book.startedAt).slice(0, 10)} disabled={!edition}
      onSave={(status, date, start) => confirmSpotifyBook(db, book, status, date, start)}
      onReset={read ? () => db.reads.delete(read.id) : undefined} resetLabel="Use listening history instead" />
    {entry && <details><summary>Book details & runtime</summary>
      <form className="row" onSubmit={(event) => { event.preventDefault(); void saveRuntime(); }}>
        <label>Full runtime (minutes)<input inputMode="decimal" type="number" min="0.01" step="any" placeholder={runtime?.toString() ?? 'e.g. 630'} value={runtimeInput} onChange={(event) => setRuntimeInput(event.target.value)} /></label>
        <button disabled={busy || !runtimeInput}>Save runtime</button>
      </form>
      <p className="small muted">Use the full length of your audiobook edition.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="small" role="status">{message}</p>}
      <ul className="loans"><BookMetadataReview entry={entry} /></ul>
    </details>}
  </details></li>;
}
