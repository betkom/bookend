import { Select } from '../components/Select';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Read } from '../db';
import { libbyLoans, type Loan } from '../loans';
import { buildRecap, confirmLoan, inPeriod, loadRecapData, loanReadId, needsBookMetadataReview, periodLabel, recapEntries } from '../recap/data';
import { buildCards, themes } from '../recap/cards';
import { loadRecapFonts } from '../recap/fonts';
import { RecapStory } from '../recap/RecapStory';
import { cardPng, downloadFile, loadFirstCover, shareCard } from '../recap/export';
import { enrichEdition, repairBookCover } from '../recap/metadata';
import { clearBookMetadataCache } from '../openLibrary';
import { clearLibbyCatalogueCache } from '../libbyCatalogue';
import { BookMetadataReview } from '../recap/BookMetadataReview';
import { prepareSpotifyBooks, spotifyBooks, spotifyEdition, spotifyFinished, spotifyRead, spotifyRuntime } from '../recap/spotify';
import { SpotifyReview } from '../recap/SpotifyReview';
import { ReadReviewForm, readStatusLabel } from '../recap/ReadReviewForm';

function LoanReview({ loan, read }: { loan: Loan; read?: Read }) {
  return <li className="recap-review-item"><details className="book-review">
    <summary><span className="review-heading"><strong>{loan.rawTitle}</strong>
      <span className="small muted">{[loan.rawAuthor, loan.format === 'audio' ? 'Audiobook' : 'Ebook'].filter(Boolean).join(' · ')}</span>
      <span className="review-state">{read ? readStatusLabel[read.status] : 'Needs review'}</span>
    </span></summary>
    <p className="small muted">Borrowed {loan.borrowedAt?.slice(0, 10) ?? 'date unknown'} · Returned {loan.returnedAt?.slice(0, 10) ?? 'not yet'}</p>
    <ReadReviewForm key={read?.status ?? 'pending'} status={read?.status} startOptional
      initialDate={(read?.finishedAt ?? loan.returnedAt ?? new Date().toISOString()).slice(0, 10)}
      initialStart={read?.startedAt?.slice(0, 10) ?? ''}
      onSave={(status, date, start) => confirmLoan(db, loan, status, date, start || undefined)}
      onReset={read ? () => db.reads.delete(loanReadId(loan)) : undefined} />
  </details></li>;
}

export function RecapView() {
  const data = useLiveQuery(() => loadRecapData(db), []);
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(0);
  const [showSpotifyReviewed, setShowSpotifyReviewed] = useState(false);
  const [showLibbyReviewed, setShowLibbyReviewed] = useState(false);
  const [themeId, setThemeId] = useState(themes[0].id);
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [index, setIndex] = useState(0);
  const [fontCss, setFontCss] = useState<string>();
  useEffect(() => { let cancelled = false; loadRecapFonts().then((css) => { if (!cancelled) setFontCss(css); }).catch((error) => { if (!cancelled) setError(error instanceof Error ? error.message : 'Could not load card fonts.'); }); return () => { cancelled = true; }; }, []);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [coverBusy, setCoverBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [prepared, setPrepared] = useState<{ svg: string; file: File }>();
  const [exportError, setExportError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [metadataRetry, setMetadataRetry] = useState(0);
  const lastMetadataRetry = useRef(0);
  const [metadataState, setMetadataState] = useState({ busy: false, completed: 0, total: 0, unmatched: 0, failed: 0 });
  const entries = useMemo(() => data ? recapEntries(data) : [], [data]);
  const period = useMemo(() => ({ year, quarter: quarter || undefined }), [year, quarter]);
  const stats = useMemo(() => buildRecap(entries, period), [entries, period]);
  const spotify = useMemo(() => data ? spotifyBooks(data.events).filter((book) => inPeriod(book.lastPlayedAt, period)
    || inPeriod(spotifyRead(data, book)?.finishedAt ?? spotifyRead(data, book)?.startedAt, period)) : [], [data, period]);
  const spotifyEventKey = JSON.stringify(data?.events.filter((event) => event.source === 'spotify').map((event) => event.id).sort() ?? []);
  useEffect(() => { void prepareSpotifyBooks(db).catch((error) => setError(error instanceof Error ? error.message : 'Could not prepare Spotify books.')); }, [spotifyEventKey]);
  const editionKey = JSON.stringify([...new Set([...stats.finished.flatMap((entry) => entry.editions.map((edition) => edition.id)),
    ...spotify.flatMap((book) => { const edition = data && spotifyEdition(data, book); return edition ? [edition.id] : []; })])].sort());
  useEffect(() => {
    let cancelled = false;
    const force = metadataRetry !== lastMetadataRetry.current;
    if (force) { clearBookMetadataCache(); clearLibbyCatalogueCache(); }
    lastMetadataRetry.current = metadataRetry;
    const ids: string[] = JSON.parse(editionKey);
    setMetadataState({ busy: ids.length > 0, completed: 0, total: ids.length, unmatched: 0, failed: 0 });
    async function enrich() {
      for (const id of ids) {
        if (cancelled) return;
        let unmatched = 0; let failed = 0;
        try {
          const result = await enrichEdition(db, id, { force, cancelled: () => cancelled });
          unmatched = !result.matched && !result.skipped ? 1 : 0;
        } catch { failed = 1; }
        if (!cancelled) setMetadataState((state) => ({ ...state, completed: state.completed + 1, unmatched: state.unmatched + unmatched, failed: state.failed + failed }));
      }
      if (!cancelled) setMetadataState((state) => ({ ...state, busy: false }));
    }
    void enrich();
    return () => { cancelled = true; };
  }, [editionKey, metadataRetry]);
  const theme = themes.find((t) => t.id === themeId)!;
  const cards = useMemo(() => buildCards(stats, theme, covers, showAbandoned, fontCss ?? ''), [stats, theme, covers, showAbandoned, fontCss]);
  const card = cards[Math.min(index, cards.length - 1)];
  useEffect(() => { setMessage(''); }, [card?.id]);
  const coverKey = JSON.stringify([...new Map(stats.finished.map((entry) => [JSON.stringify([entry.work.id, entry.coverUrls]), { workId: entry.work.id, urls: entry.coverUrls ?? [] }])).values()]);
  useEffect(() => {
    let cancelled = false;
    const requests: { workId: string; urls: string[] }[] = JSON.parse(coverKey);
    setCoverBusy(requests.some((request) => request.urls.length));
    const result: Record<string, string> = {};
    // A small worker pool keeps a long year's cover wall from flooding the network.
    const queue = [...requests];
    async function worker() {
      while (queue.length && !cancelled) {
        const request = queue.shift()!;
        const cover = await loadFirstCover(request.urls);
        if (cover.url && cover.data) result[cover.url] = cover.data;
        if (!cancelled) for (const url of cover.missing) await repairBookCover(db, request.workId, url);
      }
    }
    Promise.all(Array.from({ length: Math.min(4, requests.length) }, worker)).then(() => {
      if (!cancelled) { setCovers(result); setCoverBusy(false); }
    });
    return () => { cancelled = true; };
    // The serialized list is stable when confirmations or filters don't change covers.
  }, [coverKey, metadataRetry]);
  useEffect(() => {
    let cancelled = false; setPrepared(undefined); setExportError('');
    if (card && stats.total && fontCss !== undefined) cardPng(card).then((blob) => {
      if (!cancelled) setPrepared({ svg: card.svg, file: new File([blob], `bookend-${periodLabel(period).replace(/ /g, '-')}-${card.id}.png`, { type: 'image/png' }) });
    }).catch((e) => { if (!cancelled) setExportError(e instanceof Error ? e.message : 'Could not prepare PNG.'); });
    return () => { cancelled = true; };
  }, [card?.svg, stats.total, period, card?.id, fontCss]);
  const loans = useMemo(() => data ? libbyLoans(data.events).filter((loan) => inPeriod(loan.returnedAt ?? loan.borrowedAt, period)
    || data.reads.some((r) => r.id === loanReadId(loan) && inPeriod(r.finishedAt ?? r.startedAt, period))).reverse() : [], [data, period]);
  const years = [...new Set([new Date().getFullYear(), year, ...entries.map((e) => Number((e.finishedAt ?? e.startedAt)?.slice(0, 4))),
    ...(data?.events.map((e) => Number(e.timestamp.slice(0, 4))) ?? [])])].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => b - a);
  const file = prepared && card && prepared.svg === card.svg ? prepared.file : undefined;
  const incompleteBooks = [...new Map(stats.finished.filter(needsBookMetadataReview)
    .map((entry) => [entry.work.id, entry])).values()];
  const matchedBooks = [...new Map(stats.finished.filter((entry) => entry.work.metadataReviewedAt)
    .map((entry) => [entry.work.id, entry])).values()];
  async function share() {
    if (!file) return;
    setSharing(true); setError(''); setExportError(''); setMessage('');
    try {
      const result = await shareCard(file);
      if (result !== 'cancelled') setMessage(result === 'shared' ? 'Card shared.' : 'Card downloaded. File sharing is unavailable here.');
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Could not share this card. Try downloading it.'); }
    finally { setSharing(false); }
  }
  if (!data) return <p role="status">Loading your recap…</p>;
  return <section>
    <div className="page-heading"><h2>Your reading recap</h2><p className="muted">Your books, one story at a time.</p></div>
    <div className="recap-controls">
      <label>Year<Select value={year} onChange={(e) => { setYear(Number(e.target.value)); setIndex(0); setMessage(''); }}>{years.map((y) => <option key={y}>{y}</option>)}</Select></label>
      <label>Period<Select value={quarter} onChange={(e) => { setQuarter(Number(e.target.value)); setIndex(0); setMessage(''); }}><option value={0}>Full year</option>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Quarter {q}</option>)}</Select></label>
      <label>Theme<Select value={themeId} onChange={(e) => setThemeId(e.target.value)}>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></label>
    </div>

    {(spotify.length > 0 || loans.length > 0) && <div className="review-shortcuts">
      {spotify.length > 0 && <a href="#spotify-review" onClick={() => { const element = document.getElementById('spotify-review'); if (element instanceof HTMLDetailsElement) element.open = true; }}>Review Spotify books</a>}
      {loans.length > 0 && <a href="#libby-review" onClick={() => { const element = document.getElementById('libby-review'); if (element instanceof HTMLDetailsElement) element.open = true; }}>Review Libby books</a>}
    </div>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {card && stats.total > 0 ? <>
      <p className="recap-totals"><strong>{stats.total} <span>finished</span></strong><span>{periodLabel(period)}{stats.abandoned > 0 ? ` · ${stats.abandoned} abandoned` : ''}</span></p>
      <div className="recap-layout">
        <RecapStory cards={cards} index={index} onChange={setIndex} label={periodLabel(period)} onShare={share}
          onDownload={() => { if (file) { downloadFile(file); setMessage('Card downloaded.'); } }}
          ready={!!file && (!card.id.startsWith('covers-') || !coverBusy)} sharing={sharing} message={message} exportError={exportError} />
        <div className="recap-actions">
          <label>Card<Select value={card.id} onChange={(e) => { setIndex(cards.findIndex((c) => c.id === e.target.value)); setMessage(''); }}>{cards.map((c, i) => <option key={c.id} value={c.id}>{i + 1}. {c.title}{c.id.startsWith('covers-') ? ` (${c.id.slice(7)})` : ''}</option>)}</Select></label>

          <button className="primary" disabled={!file || sharing || (card.id.startsWith('covers-') && coverBusy)} onClick={share}>Share card</button>
          <button disabled={!file || (card.id.startsWith('covers-') && coverBusy)} onClick={() => { if (file) { downloadFile(file); setMessage('Card downloaded.'); } }}>Download PNG</button>
          <p className="muted small">Tap the card edges or swipe to move through. Your final card is a summary you can share.</p>
          {coverBusy && <p role="status" className="small muted">Preparing cover images…</p>}
          {!coverBusy && stats.finished.some((entry) => !entry.coverUrls?.some((url) => covers[url])) && <p className="small muted">Some covers are missing. Book titles appear instead.</p>}
          {exportError && <p role="alert" className="notice error">{exportError}</p>}
          {message && <p role="status" className="small">{message}</p>}
        </div>
      </div>
    </> : <div className="card"><h3>No confirmed finishes in {periodLabel(period)}</h3><p>Add a paper book with a finish date, review your imported books below, or choose another period.</p>{stats.abandoned > 0 && <p>{stats.abandoned} abandoned reads recorded.</p>}</div>}
    {stats.total > 0 && <details className="card recap-review book-settings"><summary>Book details & settings</summary>
      <label className="recap-checkbox"><input type="checkbox" checked={showAbandoned} onChange={(e) => setShowAbandoned(e.target.checked)} /> Show abandoned count</label>
      <p className="small muted">Books appear by finish date (UTC). Missing details come from Open Library; estimates are labelled.</p>
      {metadataState.busy ? <p role="status" className="small">Finding book details… {metadataState.completed} / {metadataState.total}</p>
        : <button onClick={() => setMetadataRetry((retry) => retry + 1)}>Refresh covers & book details</button>}
      {!metadataState.busy && metadataState.failed > 0 && <p role="status" className="small">Could not fetch details for {metadataState.failed} books. Check your connection and refresh to retry.</p>}
      {!metadataState.busy && metadataState.unmatched > 0 && <p className="small muted">No match found for {metadataState.unmatched} books. Search by ISBN below.</p>}
      {incompleteBooks.length > 0 && <details className="recap-review">
        <summary>Review missing book details ({incompleteBooks.length})</summary>
        <p className="small muted">Add optional details by ISBN or title.</p>
        <ul className="loans">{incompleteBooks.map((entry) => <BookMetadataReview key={entry.work.id} entry={entry} />)}</ul>
      </details>}
      {matchedBooks.length > 0 && <details className="recap-review">
        <summary>Matched books ({matchedBooks.length})</summary>
        <p className="small muted">View or change your saved book matches.</p>
        <ul className="loans">{matchedBooks.map((entry) => <BookMetadataReview key={entry.work.id} entry={entry} />)}</ul>
      </details>}
    </details>}

    {spotify.length > 0 && <details id="spotify-review" className="card recap-review" open={stats.total === 0}>
      <summary>Spotify reads ({spotify.filter((book) => !spotifyRead(data, book) && !spotifyFinished(book.minutes, spotifyRuntime(data, book))).length} to review)</summary>
      <p className="small muted">Review books with missing runtimes or less listening time.</p>
      <label className="recap-checkbox"><input type="checkbox" checked={showSpotifyReviewed} onChange={(event) => setShowSpotifyReviewed(event.target.checked)} /> Show finished and reviewed books</label>
      <details className="help"><summary>How finishes are counted</summary><p className="small muted">A book counts as finished when listening reaches its runtime minus five minutes, or more. Its last listening date is the finish date. Your review overrides this.</p><p className="small muted">Duplicate exports count once. Replays are included; playback speed and missing history can affect the result.</p></details>
      {metadataState.busy && <p role="status" className="small">Finding book details… {metadataState.completed} / {metadataState.total}</p>}
      <button disabled={metadataState.busy} onClick={() => setMetadataRetry((retry) => retry + 1)}>Refresh Spotify book details</button>
      <ul className="loans">{spotify.filter((book) => showSpotifyReviewed || (!spotifyRead(data, book) && !spotifyFinished(book.minutes, spotifyRuntime(data, book)))).map((book) => <SpotifyReview key={book.id} book={book} data={data} />)}</ul>
      {!showSpotifyReviewed && spotify.every((book) => spotifyRead(data, book) || spotifyFinished(book.minutes, spotifyRuntime(data, book))) && <p className="small muted">All Spotify books reviewed.</p>}
    </details>}
    {loans.length > 0 && <details id="libby-review" className="card recap-review" open={stats.total === 0}>
      <summary>Confirm Libby reads ({loans.filter((l) => !data.reads.some((r) => r.id === loanReadId(l))).length} to review)</summary>
      <p className="small muted">Did you finish these books? A return date alone doesn’t tell us.</p>
      <label className="recap-checkbox"><input type="checkbox" checked={showLibbyReviewed} onChange={(event) => setShowLibbyReviewed(event.target.checked)} /> Show reviewed books</label>
      <ul className="loans">{loans.filter((loan) => showLibbyReviewed || !data.reads.some((read) => read.id === loanReadId(loan))).map((loan) => <LoanReview key={loanReadId(loan)} loan={loan} read={data.reads.find((r) => r.id === loanReadId(loan))} />)}</ul>
      {!showLibbyReviewed && loans.every((loan) => data.reads.some((read) => read.id === loanReadId(loan))) && <p className="small muted">All Libby books reviewed.</p>}
    </details>}
  </section>;
}
