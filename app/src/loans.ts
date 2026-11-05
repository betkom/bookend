import type { BookFormat, RawEvent } from '@importers/types';

/**
 * Turns Libby borrow / renew / return events into loans and decides whether
 * each loan counts as a finished read.
 *
 * Current rule (deliberately simple, see `LIBBY_FINISHED_MIN_HOURS`): a loan
 * returned MORE than 24 hours after it was borrowed is finished; returned
 * within 24 hours is not read (sampled and handed back). Phase 2's review
 * inbox will let the user override individual loans.
 *
 * Computed on the fly, never stored, so changing the rule needs no re-import.
 */

/** A loan must last longer than this to count as finished. */
export const LIBBY_FINISHED_MIN_HOURS = 24;

export type LoanStatus =
  /** Returned more than LIBBY_FINISHED_MIN_HOURS after borrowing. */
  | 'finished'
  /** Returned within LIBBY_FINISHED_MIN_HOURS. */
  | 'not-read'
  /** Borrowed, not returned yet. */
  | 'in-progress'
  /** A return with no matching borrow in the data (e.g. a filtered export). */
  | 'unknown';

export interface Loan {
  /** How events were grouped: Libby title id, else ISBN, else title + author. */
  key: string;
  rawTitle: string;
  rawAuthor: string;
  format?: BookFormat;
  isbn?: string;
  borrowedAt?: string;
  returnedAt?: string;
  renewals: number;
  /** Days between borrow and return, when both are known. */
  durationDays?: number;
  status: LoanStatus;
  eventIds: string[];
}

type LoanEvent = RawEvent & { id?: string };

const HOUR = 60 * 60 * 1000;

export function loanKey(e: RawEvent): string {
  if (e.sourceItemId) return `id:${e.sourceItemId}`;
  if (e.isbn) return `isbn:${e.isbn}`;
  return `t:${e.rawTitle.trim().toLowerCase()}|${e.rawAuthor.trim().toLowerCase()}`;
}

export function loanStatus(borrowedAt?: string, returnedAt?: string): LoanStatus {
  if (!borrowedAt) return 'unknown';
  if (!returnedAt) return 'in-progress';
  const hours = (Date.parse(returnedAt) - Date.parse(borrowedAt)) / HOUR;
  return hours > LIBBY_FINISHED_MIN_HOURS ? 'finished' : 'not-read';
}

function finish(loan: Omit<Loan, 'status' | 'durationDays'>): Loan {
  const durationDays =
    loan.borrowedAt && loan.returnedAt ? (Date.parse(loan.returnedAt) - Date.parse(loan.borrowedAt)) / (24 * HOUR) : undefined;
  return { ...loan, durationDays, status: loanStatus(loan.borrowedAt, loan.returnedAt) };
}

/** Group Libby events into loans, oldest first. Non-Libby events are ignored. */
export function libbyLoans(events: LoanEvent[]): Loan[] {
  const sorted = events
    .filter((e) => e.source === 'libby' && (e.type === 'borrowed' || e.type === 'renewed' || e.type === 'returned'))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const open = new Map<string, Omit<Loan, 'status' | 'durationDays'>>();
  const loans: Loan[] = [];

  for (const e of sorted) {
    const key = loanKey(e);
    const current = open.get(key);
    const ids = e.id ? [e.id] : [];

    if (e.type === 'borrowed') {
      // A second borrow while one is open means we never saw the return: close the old one as is.
      if (current) loans.push(finish(current));
      open.set(key, {
        key,
        rawTitle: e.rawTitle,
        rawAuthor: e.rawAuthor,
        format: e.format,
        isbn: e.isbn,
        borrowedAt: e.timestamp,
        renewals: 0,
        eventIds: ids,
      });
    } else if (e.type === 'renewed') {
      if (current) {
        current.renewals++;
        current.eventIds.push(...ids);
      }
    } else {
      // returned
      if (current) {
        loans.push(finish({ ...current, returnedAt: e.timestamp, eventIds: [...current.eventIds, ...ids] }));
        open.delete(key);
      } else {
        loans.push(
          finish({ key, rawTitle: e.rawTitle, rawAuthor: e.rawAuthor, format: e.format, isbn: e.isbn, returnedAt: e.timestamp, renewals: 0, eventIds: ids }),
        );
      }
    }
  }
  for (const loan of open.values()) loans.push(finish(loan));

  const at = (l: Loan) => l.borrowedAt ?? l.returnedAt ?? '';
  return loans.sort((a, b) => at(a).localeCompare(at(b)));
}

export function summariseLoans(loans: Loan[]): Record<LoanStatus, number> {
  const out: Record<LoanStatus, number> = { finished: 0, 'not-read': 0, 'in-progress': 0, unknown: 0 };
  for (const l of loans) out[l.status]++;
  return out;
}

