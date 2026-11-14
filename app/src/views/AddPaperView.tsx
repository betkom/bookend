import { useEffect, useRef, useState } from 'react';
import type { BookFormat } from '@importers/types';
import { Select } from '../components/Select';
import { db } from '../db';
import { addPaperBook } from '../importService';
import { normaliseIsbn } from '../isbn';
import { lookupAudioRuntime, lookupIsbn, searchBooks, type BookCandidate } from '../openLibrary';
import { scanGuide } from '../scanGuide';
import { startIsbnScan, type ScanHandle } from '../scanner';

type Step = 'find' | 'details';

export function AddPaperView({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('find');
  const [book, setBook] = useState<BookCandidate | null>(null);

  if (step === 'details' && book) {
    return (
      <PaperDetails
        book={book}
        onBack={() => setStep('find')}
        onSaved={onDone}
      />
    );
  }
  return (
    <FindBook
      onPick={(b) => {
        setBook(b);
        setStep('details');
      }}
    />
  );
}

function FindBook({ onPick }: { onPick: (b: BookCandidate) => void }) {
  const [isbn, setIsbn] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [results, setResults] = useState<BookCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanRef = useRef<ScanHandle | null>(null);

  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    const controller = new AbortController();
    void startIsbnScan(
      videoRef.current,
      (code) => {
        setScanning(false);
        setIsbn(code);
        void byIsbn(code);
      },
      (message) => {
        setScanning(false);
        setError(message);
      },
      controller.signal,
      setScanStatus,
    ).then((handle) => {
      if (controller.signal.aborted) handle.stop();
      else scanRef.current = handle;
    });
    return () => {
      controller.abort();
      scanRef.current = null;
    };
  }, [scanning]);

  async function byIsbn(raw: string) {
    const clean = normaliseIsbn(raw);
    if (!clean) {
      setError('That doesn’t look like a valid ISBN.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const found = await lookupIsbn(clean);
      if (found) onPick(found);
      else setError(`Open Library doesn't know ISBN ${clean}. Try searching by title, or enter it manually.`);
    } catch {
      setError('Could not reach Open Library. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function byTitle() {
    if (!title.trim() && !author.trim()) return;
    setError('');
    setBusy(true);
    try {
      setResults(await searchBooks(title.trim(), author.trim()));
    } catch {
      setError('Could not reach Open Library. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function toggleScan() {
    if (scanning) scanRef.current?.stop();
    setError('');
    setScanStatus('Starting camera…');
    setScanning(!scanning);
  }

  return (
    <section>
      <h2>Add a book</h2>

      <div className="card">
        <h3>Scan or type the ISBN</h3>
        <button className="primary" onClick={toggleScan}>
          {scanning ? 'Stop camera' : 'Scan barcode'}
        </button>
        {scanning && (
          <>
            <div className="scanner-preview">
              <video ref={videoRef} className="scanner" playsInline muted aria-label="Barcode camera preview" />
              <span
                aria-hidden="true"
                className="scanner-guide"
                style={{ inset: `${scanGuide.yInset * 100}% ${scanGuide.xInset * 100}%` }}
              />
            </div>
            <p className="muted small" role="status">{scanStatus}</p>
            <p className="muted small">
              Line up the ISBN barcode in the box, with white space on both sides. If the bars look blurry, move the book back slightly.
            </p>
          </>
        )}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            byIsbn(isbn);
          }}
        >
          <input aria-label="ISBN" inputMode="text" placeholder="ISBN-10 or ISBN-13" value={isbn} onChange={(e) => setIsbn(e.target.value)} />
          <button type="submit" disabled={busy || !isbn}>
            Look up
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Or search by title or author</h3>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            byTitle();
          }}
        >
          <input aria-label="Title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label="Author" placeholder="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <button type="submit" disabled={busy || (!title.trim() && !author.trim())}>
            Search
          </button>
        </form>
        {results && results.length === 0 && <p className="muted">No matches.</p>}
        {results && results.length > 0 && (
          <ul className="candidates">
            {results.map((r) => (
              <li key={r.openLibraryWorkId ?? r.title}>
                <button onClick={() => onPick({ ...r, isbn: undefined, openLibraryEditionId: undefined })}>
                  {r.coverUrl ? <img src={r.coverUrl} alt="" loading="lazy" /> : <span className="nocover" />}
                  <span>
                    <strong>{r.title}</strong>
                    <span className="muted small">
                      {r.authors.join(', ')}
                      {r.firstPublishYear ? ` · ${r.firstPublishYear}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          className="link"
          onClick={() => onPick({ title: title.trim(), authors: author.trim() ? [author.trim()] : [] })}
          disabled={!title.trim()}
        >
          Not listed? Add “{title.trim() || '…'}” manually
        </button>
      </div>

      {busy && <p className="muted">Looking it up…</p>}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function PaperDetails({ book, onBack, onSaved }: { book: BookCandidate; onBack: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(book.title);
  const [authors, setAuthors] = useState(book.authors.join(', '));
  const [format, setFormat] = useState<BookFormat>('paper');
  const [pages, setPages] = useState(book.pages ? String(book.pages) : '');
  const [hours, setHours] = useState(book.durationMinutes ? String(book.durationMinutes / 60) : '');
  const [durationSource, setDurationSource] = useState(book.durationSource);
  const hoursEdited = useRef(false);
  const [loadingRuntime, setLoadingRuntime] = useState(false);

  useEffect(() => {
    if (format !== 'audio' || book.durationMinutes || !book.openLibraryWorkId) return;
    let cancelled = false;
    setLoadingRuntime(true);
    void lookupAudioRuntime(book.openLibraryWorkId).then((minutes) => {
      if (!cancelled && !hoursEdited.current && minutes) {
        setHours(String(minutes / 60));
        setDurationSource('open-library-work');
      }
    }).catch(() => { /* The length can still be entered manually. */ }).finally(() => {
      if (!cancelled) setLoadingRuntime(false);
    });
    return () => { cancelled = true; setLoadingRuntime(false); };
  }, [format, book]);
  const [startedAt, setStartedAt] = useState('');
  const [finishedAt, setFinishedAt] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!title.trim()) return;
    if (format === 'audio' && hours && (!Number.isFinite(Number(hours)) || Number(hours) <= 0)) {
      setError('Enter a valid audiobook length in hours.');
      return;
    }
    if (format !== 'audio' && pages && (!Number.isSafeInteger(Number(pages)) || Number(pages) <= 0)) {
      setError('Enter a valid number of pages.');
      return;
    }
    if (startedAt && finishedAt && startedAt > finishedAt) {
      setError('The start date is after the finish date.');
      return;
    }
    setSaving(true);
    try {
      await addPaperBook(db, {
        title: title.trim(),
        format,
        durationMinutes: format === 'audio' && hours ? Number(hours) * 60 : undefined,
        durationSource: format === 'audio' && hours ? (hoursEdited.current ? 'manual' : durationSource) : undefined,
        authors: authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        openLibraryWorkId: book.openLibraryWorkId,
        openLibraryEditionId: book.openLibraryEditionId,
        isbn: book.isbn,
        pages: format !== 'audio' && pages ? Number(pages) : undefined,
        pagesSource: format !== 'audio' && pages && Number(pages) === book.pages ? book.pagesSource : undefined,
        coverUrl: book.coverUrl,
        openLibrarySubjects: book.subjects,
        startedAt: startedAt || undefined,
        finishedAt: finishedAt || undefined,
      });
      onSaved();
    } catch (e) {
      console.error(e);
      setError('Could not save the book.');
      setSaving(false);
    }
  }

  return (
    <section>
      <button className="link" onClick={onBack}>
        ← Back
      </button>
      <div className="book-head">
        {book.coverUrl ? <img src={book.coverUrl.replace('-M.jpg', '-L.jpg')} alt="" /> : <span className="nocover big" />}
        <div className="stack grow">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Authors (comma separated)
            <input value={authors} onChange={(e) => setAuthors(e.target.value)} />
          </label>
          <label>
            Format
            <Select value={format} onChange={(e) => setFormat(e.target.value as BookFormat)}>
              <option value="paper">Paper</option>
              <option value="ebook">E-book</option>
              <option value="audio">Audiobook</option>
            </Select>
          </label>
          {format === 'audio' ? <label>
            Total listening hours
            <input type="number" min="0" step="any" inputMode="decimal" placeholder="e.g. 10.5" value={hours} onChange={(e) => { hoursEdited.current = true; setHours(e.target.value); }} />
          </label> : <label>
            Pages
            <input inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value.replace(/\D/g, ''))} />
          </label>}
          {format === 'audio' && loadingRuntime && <p className="muted small" role="status">Looking up audiobook length…</p>}
          <p className="muted small">Leave the length blank if unknown. Open Library information is filled in when available.</p>
          {book.isbn && <p className="muted small">ISBN {book.isbn}</p>}
        </div>
      </div>
      <div className="row dates">
        <label>
          Started
          <input type="date" value={startedAt} max={today()} onInput={(e) => setStartedAt(e.currentTarget.value)} />
        </label>
        <label>
          Finished
          <input type="date" value={finishedAt} max={today()} onInput={(e) => setFinishedAt(e.currentTarget.value)} />
        </label>
      </div>
      <p className="muted small">Leave both dates empty for Not started. Enter a start date without a finish date for In progress.</p>
      {error && <div className="notice error">{error}</div>}
      <button className="primary" onClick={save} disabled={saving || !title.trim() || (format === 'audio' && loadingRuntime)}>
        Save book
      </button>
    </section>
  );
}

