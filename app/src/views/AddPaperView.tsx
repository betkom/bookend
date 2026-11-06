import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import { addPaperBook } from '../importService';
import { normaliseIsbn } from '../isbn';
import { lookupIsbn, searchBooks, type BookCandidate } from '../openLibrary';
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanRef = useRef<ScanHandle | null>(null);

  useEffect(() => () => scanRef.current?.stop(), []);

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
    if (!title.trim()) return;
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

  async function toggleScan() {
    if (scanning) {
      scanRef.current?.stop();
      setScanning(false);
      return;
    }
    setScanning(true);
    setError('');
    // Wait a tick so the <video> is rendered.
    await new Promise((r) => setTimeout(r, 0));
    scanRef.current = await startIsbnScan(
      videoRef.current!,
      (code) => {
        setScanning(false);
        setIsbn(code);
        byIsbn(code);
      },
      (msg) => {
        setScanning(false);
        setError(msg);
      },
    );
  }

  return (
    <section>
      <h2>Add a paper book</h2>

      <div className="card">
        <h3>Scan or type the ISBN</h3>
        <button className="primary" onClick={toggleScan}>
          {scanning ? 'Stop camera' : 'Scan barcode'}
        </button>
        {scanning && <video ref={videoRef} className="scanner" playsInline muted />}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            byIsbn(isbn);
          }}
        >
          <input aria-label="ISBN" inputMode="numeric" placeholder="978…" value={isbn} onChange={(e) => setIsbn(e.target.value)} />
          <button type="submit" disabled={busy || !isbn}>
            Look up
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Or search by title</h3>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            byTitle();
          }}
        >
          <input aria-label="Title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label="Author (optional)" placeholder="Author (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <button type="submit" disabled={busy || !title.trim()}>
            Search
          </button>
        </form>
        {results && results.length === 0 && <p className="muted">No matches.</p>}
        {results && results.length > 0 && (
          <ul className="candidates">
            {results.map((r) => (
              <li key={r.openLibraryWorkId ?? r.title}>
                <button onClick={() => onPick(r)}>
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
  const [pages, setPages] = useState(book.pages ? String(book.pages) : '');
  const [startedAt, setStartedAt] = useState('');
  const [finishedAt, setFinishedAt] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!title.trim()) return;
    if (startedAt && finishedAt && startedAt > finishedAt) {
      setError('The start date is after the finish date.');
      return;
    }
    setSaving(true);
    try {
      await addPaperBook(db, {
        title: title.trim(),
        authors: authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        openLibraryWorkId: book.openLibraryWorkId,
        openLibraryEditionId: book.openLibraryEditionId,
        isbn: book.isbn,
        pages: pages ? Number(pages) : undefined,
        pagesSource: pages && Number(pages) === book.pages ? book.pagesSource : undefined,
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
            Pages
            <input inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value.replace(/\D/g, ''))} />
          </label>
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
      <button className="primary" onClick={save} disabled={saving || !title.trim()}>
        Save book
      </button>
    </section>
  );
}

