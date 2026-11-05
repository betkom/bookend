import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { libbyLoans, summariseLoans, type LoanStatus } from '../loans';

const STATUS_LABEL: Record<LoanStatus, string> = {
  finished: 'Likely read',
  'not-read': 'Short loan',
  'in-progress': 'On loan',
  unknown: 'Unknown',
};

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown');

function duration(days?: number) {
  if (days === undefined) return '';
  if (days < 1) {
    const mins = Math.round(days * 24 * 60);
    return mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`;
  }
  return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`;
}

export function LoansView() {
  const events = useLiveQuery(() => db.events.where('source').equals('libby').toArray(), []);
  const loans = useMemo(() => (events ? libbyLoans(events).reverse() : []), [events]);

  if (!events) return null;
  if (!loans.length) {
    return (
      <section className="empty">
        <h2>No Libby loans yet</h2>
        <p>Import your Libby timeline to see your loans.</p>
      </section>
    );
  }

  const s = summariseLoans(loans);
  return (
    <section>
      <h2>Libby loans</h2>
      <p className="muted small">
        These estimates use how long you borrowed each book. Confirm what you finished in Recap.
      </p>
      <p className="summary">
        <strong>{s.finished}</strong> likely read · <strong>{s['not-read']}</strong> short loans
        {s['in-progress'] > 0 && (
          <>
            {' '}
            · <strong>{s['in-progress']}</strong> on loan
          </>
        )}
        {s.unknown > 0 && (
          <>
            {' '}
            · <strong>{s.unknown}</strong> unknown
          </>
        )}
      </p>
      <ul className="loans">
        {loans.map((l) => (
          <li key={l.eventIds[0] ?? `${l.key}-${l.borrowedAt ?? l.returnedAt}`} className={l.status}>
            <span className="what">
              <strong>{l.rawTitle}</strong>
              <span className="muted small">
                {l.rawAuthor}
                {l.format ? ` · ${l.format}` : ''}
              </span>
              <span className="muted small">
                {day(l.borrowedAt)} → {l.returnedAt ? day(l.returnedAt) : 'now'}
                {l.durationDays !== undefined && ` · ${duration(l.durationDays)}`}
                {l.renewals > 0 && ` · renewed ${l.renewals}×`}
              </span>
            </span>
            <span className={`status ${l.status}`}>{STATUS_LABEL[l.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

