import { Select } from '../components/Select';
import { useState } from 'react';
import { db } from '../db';
import { applyBookMetadataMatch, findBookMetadata, keepBookMetadataMatch, type BookMetadataMatch } from './metadata';
import { missingBookDetails, type RecapEntry } from './data';

export function BookMetadataReview({ entry }: { entry: RecapEntry }) {
  const [matches, setMatches] = useState<BookMetadataMatch[]>();
  const [editionId, setEditionId] = useState(entry.editions[0]?.id ?? '');
  const [isbn, setIsbn] = useState(entry.editions[0]?.isbn ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const missing = missingBookDetails(entry);
  async function find(mode: 'auto' | 'isbn' | 'title' = 'auto') {
    setBusy(true); setError(''); setMessage(''); setMatches(undefined);
    try {
      const results = await findBookMetadata(entry.work, entry.editions, { ...(mode === 'isbn' ? { isbn, editionId } : {}), titleOnly: mode === 'title' });
      setMatches(results);
      if (!results.length) setMessage(mode === 'isbn' ? 'Open Library has no edition for this ISBN. Check the number or search by title.' : 'No book matches found.');
      else setMessage(results[0].kind === 'isbn' ? 'Exact edition found by ISBN. Select it to use its details.' : 'Title and author results. Select the correct book.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reach Open Library. Check your connection.'); }
    finally { setBusy(false); }
  }
  async function choose(match: BookMetadataMatch) {
    setBusy(true); setError('');
    try {
      await applyBookMetadataMatch(db, entry.editions, match);
      setMatches(undefined); setMessage('Match saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save book details. Please try again.'); }
    finally { setBusy(false); }
  }
  async function keepMatch() {
    setBusy(true); setError('');
    try { await keepBookMetadataMatch(db, entry.work.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not keep this match.'); }
    finally { setBusy(false); }
  }
  return <li className="recap-review-item">
    <strong>{entry.work.title}</strong>
    <span className="muted small">{entry.work.authors.join(', ')} · {entry.formats.join(', ')}</span>
    <span className="muted small">{missing.length ? `Missing: ${missing.join(', ')}. Optional.` : 'Book details complete.'}</span>
    {entry.work.metadataReviewedAt && <span className="small muted">Match saved.</span>}
    {!entry.work.metadataReviewedAt && entry.work.openLibraryWorkId && <button disabled={busy} onClick={keepMatch}>Keep this match</button>}
    <form className="row" onSubmit={(event) => { event.preventDefault(); void find('isbn'); }}>
      {entry.editions.length > 1 && <label>Format<Select value={editionId} onChange={(event) => {
        setEditionId(event.target.value); setIsbn(entry.editions.find((edition) => edition.id === event.target.value)?.isbn ?? ''); setMatches(undefined); setMessage('');
      }}>{entry.editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.format}{edition.isbn ? ` · ${edition.isbn}` : ''}</option>)}</Select></label>}
      <label>ISBN<input inputMode="numeric" value={isbn} placeholder="ISBN-10 or ISBN-13" onChange={(event) => { setIsbn(event.target.value); setMatches(undefined); setMessage(''); }} /></label>
      <button disabled={busy || !isbn.trim()} type="submit">Look up ISBN</button>
    </form>
    <div className="row">
      <button disabled={busy} onClick={() => find()}>{busy ? 'Looking up…' : 'Search for this book'}</button>
      <button disabled={busy} onClick={() => find('title')}>Search by title</button>
    </div>
    {error && <p role="alert" className="small">{error}</p>}
    {message && <p role="status" className="small muted">{message}</p>}
    {matches && matches.length > 0 && <ul className="candidates">{matches.map((match, index) => {
      const { candidate } = match;
      return <li key={`${candidate.openLibraryEditionId ?? candidate.openLibraryWorkId}-${index}`}>
        <button disabled={busy} onClick={() => choose(match)}>
          {candidate.coverUrl ? <img src={candidate.coverUrl} alt="" loading="lazy" /> : <span className="nocover" />}
          <span><strong>{candidate.title}</strong><span className="muted small">{candidate.authors.join(', ')}{candidate.firstPublishYear ? ` · ${candidate.firstPublishYear}` : ''}{candidate.pages ? ` · ${candidate.pagesSource === 'open-library-median' ? '~' : ''}${candidate.pages} pages` : ''}{candidate.durationMinutes ? ` · ${(candidate.durationMinutes / 60).toFixed(1)} audio hours` : ''}</span>
            <span className="small muted">{match.kind === 'isbn' ? `Exact ISBN: ${candidate.isbn}` : 'Title match'}</span>
          </span>
        </button>
      </li>;
    })}</ul>}
  </li>;
}
