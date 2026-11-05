import { Select } from '../components/Select';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ReadingEvent } from '../db';
import type { SourceId } from '@importers/types';

const SOURCE_LABEL: Record<SourceId, string> = { libby: 'Libby', paper: 'Paper', audible: 'Audible', spotify: 'Spotify' };
const TYPE_LABEL: Record<ReadingEvent['type'], string> = {
  borrowed: 'Borrowed',
  renewed: 'Renewed',
  returned: 'Returned',
  started: 'Started',
  listened: 'Listened',
  progress: 'Progress',
  finished: 'Finished',
};

const monthKey = (iso: string) => iso.slice(0, 7);

const monthLabel = (key: string) =>
  new Date(key + '-01T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function LogView({ onGoImport }: { onGoImport: () => void }) {
  const events = useLiveQuery(() => db.events.orderBy('timestamp').reverse().toArray(), []);
  const [source, setSource] = useState<SourceId | 'all'>('all');
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (events ?? []).filter(
      (e) =>
        (source === 'all' || e.source === source) &&
        (!q || e.rawTitle.toLowerCase().includes(q) || e.rawAuthor.toLowerCase().includes(q)),
    );
    const groups = new Map<string, ReadingEvent[]>();
    for (const e of list) {
      const k = monthKey(e.timestamp);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(e);
    }
    return [...groups];
  }, [events, source, query]);

  if (!events) return null;
  if (!events.length) {
    return (
      <section className="empty">
        <h2>Nothing here yet</h2>
        <p>Import your Libby or Spotify history, or add a book.</p>
        <button className="primary" onClick={onGoImport}>
          Import a file
        </button>
      </section>
    );
  }

  const sources = [...new Set(events.map((e) => e.source))];

  return (
    <section>
      <div className="page-heading"><h2>Reading log</h2></div>
      <div className="filters">
        <input aria-label="Search books" type="search" placeholder="Filter by title or author" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as SourceId | 'all')}>
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      <p className="muted small">
        {events.length} activities
      </p>
      {grouped.length === 0 && <p className="empty">No books match your search.</p>}
      {grouped.map(([month, list]) => (
        <div key={month} className="month">
          <h3>{monthLabel(month)}</h3>
          <ul className="events">
            {list.map((e) => (
              <li key={e.id}>
                <span className="date">{dayLabel(e.timestamp)}</span>
                <span className={`badge ${e.source}`}>{SOURCE_LABEL[e.source]}</span>
                <span className="what">
                  <strong>{e.rawTitle}</strong>
                  {e.rawAuthor && <span className="muted"> · {e.rawAuthor}</span>}
                </span>
                <span className={`type ${e.type}`}>
                  {TYPE_LABEL[e.type]}
                  {e.format && e.format !== 'paper' ? ` (${e.format})` : ''}
                  {e.type === 'listened' && e.value !== undefined && Number.isFinite(e.value) ? ` · ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(e.value)} min` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

