import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { SourceId } from '@importers/types';
import { db } from '../db';
import { Select } from '../components/Select';
import { entryPages, entryRuntime } from '../recap/data';
import { filterReadingRecords, formatLabels, loadReadsData, readingRecords, readingStatusLabels, sourceLabels, type ReadingRecord, type ReadingStatus } from '../reads';

const day = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const minutes = (value: number) => `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} min`;

function BookCover({ urls }: { urls: string[] }) {
  const [index, setIndex] = useState(0);
  return urls[index] ? <img className="read-cover" src={urls[index]} alt="" loading="lazy" onError={() => setIndex((value) => value + 1)} />
    : <span className="read-cover read-cover-placeholder" aria-hidden="true">No cover</span>;
}

function BookDetails({ item }: { item: ReadingRecord }) {
  const pages = item.entry ? entryPages(item.entry) : item.editions.find((edition) => edition.format !== 'audio')?.pages;
  const runtime = item.entry ? entryRuntime(item.entry) : item.durationMinutes ?? item.editions.find((edition) => edition.format === 'audio')?.durationMinutes;
  const isbns = [...new Set([...item.editions.map((edition) => edition.isbn), item.loan?.isbn].filter(Boolean))];
  const estimatedPages = pages !== undefined && item.editions.some((edition) => edition.pages === pages && edition.pagesSource === 'open-library-median');
  const runtimeSource = item.editions.find((edition) => edition.durationMinutes === runtime)?.durationSource;
  return <dl className="read-details">
    {item.formats.length > 0 && <div><dt>Format</dt><dd>{item.formats.map((format) => formatLabels[format]).join(', ')}</dd></div>}
    {item.sources.length > 0 && <div><dt>Source</dt><dd>{item.sources.map((source) => sourceLabels[source]).join(', ')}</dd></div>}
    {item.startedAt && <div><dt>Started</dt><dd>{day(item.startedAt)}</dd></div>}
    {item.endedAt && <div><dt>{item.status === 'abandoned' ? 'Set aside' : 'Finished'}</dt><dd>{day(item.endedAt)}</dd></div>}
    {item.genres.length > 0 && <div><dt>Genres</dt><dd>{item.genres.join(', ')}</dd></div>}
    {isbns.length > 0 && <div><dt>ISBN</dt><dd>{isbns.join(', ')}</dd></div>}
    {pages !== undefined && pages > 0 && <div><dt>Pages{estimatedPages ? ' (estimated)' : ''}</dt><dd>{pages}</dd></div>}
    {runtime !== undefined && runtime > 0 && <div><dt>Audio runtime{runtimeSource === 'open-library-work' ? ' (estimated)' : ''}</dt><dd>{minutes(runtime)}</dd></div>}
    {item.minutesListened !== undefined && <div><dt>Listened</dt><dd>{minutes(item.minutesListened)}</dd></div>}
    {item.loan?.borrowedAt && <div><dt>Borrowed from Libby</dt><dd>{day(item.loan.borrowedAt)}</dd></div>}
    {item.loan?.returnedAt && <div><dt>Returned to Libby</dt><dd>{day(item.loan.returnedAt)}</dd></div>}
    {!!item.loan?.renewals && <div><dt>Renewals</dt><dd>{item.loan.renewals}</dd></div>}
  </dl>;
}

export function ReadsView({ onGoImport, onAddBook }: { onGoImport: () => void; onAddBook: () => void }) {
  const [error, setError] = useState('');
  const data = useLiveQuery(async () => {
    try { return await loadReadsData(db); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load your reads.'); return undefined; }
  }, []);
  const records = useMemo(() => data ? readingRecords(data) : [], [data]);
  const [source, setSource] = useState<SourceId | 'all'>('all');
  const [status, setStatus] = useState<ReadingStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const filtered = filterReadingRecords(records, query, source, status);
  if (error) return <p role="alert" className="notice error">{error}</p>;
  if (!data) return <p role="status">Loading your reads…</p>;
  if (!records.length) return <section className="empty">
    <h2>{data.events.length || data.batches.length ? 'No reads yet' : 'Your reading starts here'}</h2>
    <p>Import your history or add a book. Returned Libby loans appear here once you confirm a read in Recap.</p>
    <div className="read-empty-actions"><button className="primary" onClick={onGoImport}>Import a file</button><button onClick={onAddBook}>Add book</button></div>
  </section>;
  // Keep the selected source available when an import is undone so the user can reset it.
  const sources = [...new Set([...records.flatMap((item) => item.sources), ...(source === 'all' ? [] : [source])])];
  return <section>
    <div className="page-heading"><h2>Reads</h2></div>
    <div className="filters read-filters">
      <input aria-label="Search books" type="search" placeholder="Filter by title or author" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Select aria-label="Source" value={source} onChange={(event) => setSource(event.target.value as SourceId | 'all')}>
        <option value="all">All sources</option>{sources.map((source) => <option key={source} value={source}>{sourceLabels[source]}</option>)}
      </Select>
      <Select aria-label="Reading status" value={status} onChange={(event) => setStatus(event.target.value as ReadingStatus | 'all')}>
        <option value="all">All statuses</option>{Object.entries(readingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
    </div>
    <p className="muted small" role="status">{filtered.length} {filtered.length === 1 ? 'record' : 'records'}</p>
    {!filtered.length && <p className="empty">No books match your filters.</p>}
    <ul className="reads">{filtered.map((item) => <li key={item.id}>
      <details className="read-book">
        <summary>
          <BookCover key={JSON.stringify(item.coverUrls)} urls={item.coverUrls} />
          <span className="read-heading">
            <strong>{item.work.title}</strong>
            {item.work.authors.length > 0 && <span className="muted small">{item.work.authors.join(', ')}</span>}
            <span className="read-tags"><span className={`status ${item.status}`}>{readingStatusLabels[item.status]}</span>
              {item.sources.map((source) => <span key={source} className={`badge ${source}`}>{sourceLabels[source]}</span>)}
              {item.loan && !item.loan.returnedAt && <span className="badge">On loan</span>}
            </span>
            <span className="muted small">{item.formats.map((format) => formatLabels[format]).join(' · ')}
              {item.activityAt && `${item.formats.length ? ' · ' : ''}${item.loan && !item.startedAt && !item.endedAt ? 'Borrowed ' : item.endedAt ? (item.status === 'abandoned' ? 'Set aside ' : 'Finished ') : item.sources.includes('spotify') ? 'Last listened ' : 'Started '}${day(item.activityAt)}`}
            </span>
          </span>
          <span className="read-disclosure" aria-hidden="true">⌄</span>
        </summary>
        <BookDetails item={item} />
      </details>
    </li>)}</ul>
  </section>;
}
