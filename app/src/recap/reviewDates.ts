import type { Read } from '../db';

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;

/** A start without a finish records progress, never an inferred completion. */
export function reviewDates(status: Read['status'], date: string, start = '', startOptional = true): Pick<Read, 'status' | 'startedAt' | 'finishedAt'> {
  if (!['in-progress', 'finished', 'abandoned', 'not-read'].includes(status)) throw new Error('Choose a valid reading status.');
  if (status === 'not-read') return { status, startedAt: undefined, finishedAt: undefined };
  if (status === 'finished' && !date && start) status = 'in-progress';
  const inProgress = status === 'in-progress';
  if (!inProgress && !validDate(date)) throw new Error('Choose a valid finish date.');
  if ((!startOptional || inProgress || start) && !validDate(start)) throw new Error('Choose a valid start date.');
  if (!inProgress && start && start > date) throw new Error('Choose a valid start date on or before the finish date.');
  return { status, startedAt: start ? `${start}T12:00:00.000Z` : undefined,
    finishedAt: inProgress ? undefined : `${date}T12:00:00.000Z` };
}
