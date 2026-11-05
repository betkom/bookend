import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RawEvent } from '@importers/types';
import { libbyImporter } from '@importers/libby';
import { libbyLoans, loanStatus, summariseLoans } from './loans';

const ev = (type: RawEvent['type'], timestamp: string, extra: Partial<RawEvent & { id: string }> = {}): RawEvent & { id?: string } => ({
  source: 'libby',
  type,
  rawTitle: 'Book',
  rawAuthor: 'Author',
  timestamp,
  sourceItemId: '1',
  ...extra,
});

describe('loanStatus — "more than a day" rule', () => {
  const borrowed = '2026-05-01T10:00:00.000Z';
  it('finished when returned more than 24h later', () => {
    expect(loanStatus(borrowed, '2026-05-02T10:00:01.000Z')).toBe('finished');
    expect(loanStatus(borrowed, '2026-05-20T10:00:00.000Z')).toBe('finished');
  });
  it('not read when returned within 24h, including exactly 24h', () => {
    expect(loanStatus(borrowed, '2026-05-01T10:05:00.000Z')).toBe('not-read');
    expect(loanStatus(borrowed, '2026-05-02T10:00:00.000Z')).toBe('not-read');
  });
  it('in progress without a return, unknown without a borrow', () => {
    expect(loanStatus(borrowed, undefined)).toBe('in-progress');
    expect(loanStatus(undefined, '2026-05-02T10:00:00.000Z')).toBe('unknown');
  });
});

describe('libbyLoans', () => {
  it('pairs borrow, renewals and return into one loan', () => {
    const [loan] = libbyLoans([
      ev('returned', '2026-05-20T10:00:00.000Z', { id: 'c' }),
      ev('borrowed', '2026-05-01T10:00:00.000Z', { id: 'a' }),
      ev('renewed', '2026-05-14T10:00:00.000Z', { id: 'b' }),
    ]);
    expect(loan).toMatchObject({ status: 'finished', renewals: 1, durationDays: 19, eventIds: ['a', 'b', 'c'] });
  });

  it('treats a re-borrow of the same title as a separate loan', () => {
    const loans = libbyLoans([
      ev('borrowed', '2026-01-01T10:00:00.000Z'),
      ev('returned', '2026-01-01T10:10:00.000Z'),
      ev('borrowed', '2026-03-01T10:00:00.000Z'),
      ev('returned', '2026-03-09T10:00:00.000Z'),
    ]);
    expect(loans.map((l) => l.status)).toEqual(['not-read', 'finished']);
  });

  it('groups by ISBN, then title + author, when there is no Libby title id (CSV)', () => {
    const loans = libbyLoans([
      ev('borrowed', '2026-01-01T10:00:00.000Z', { sourceItemId: undefined, isbn: '9780141439518' }),
      ev('returned', '2026-01-05T10:00:00.000Z', { sourceItemId: undefined, isbn: '9780141439518' }),
      ev('borrowed', '2026-01-01T10:00:00.000Z', { sourceItemId: undefined, rawTitle: 'Other' }),
      ev('returned', '2026-01-05T10:00:00.000Z', { sourceItemId: undefined, rawTitle: 'other ' }),
    ]);
    expect(loans).toHaveLength(2);
    expect(loans.every((l) => l.status === 'finished')).toBe(true);
  });

  it('ignores paper events', () => {
    expect(libbyLoans([{ ...ev('finished', '2026-01-01T00:00:00.000Z'), source: 'paper' }])).toEqual([]);
  });

  it('works on the synthetic CSV fixture', () => {
    const csv = readFileSync(fileURLToPath(new URL('../../fixtures/libby/synthetic-timeline.csv', import.meta.url)), 'utf8');
    const loans = libbyLoans(libbyImporter.parse(csv, 'x.csv').events);
    expect(loans.map((l) => `${l.rawTitle}:${l.status}`)).toEqual([
      'Pride and Prejudice:finished',
      'No Isbn Book:in-progress',
      'Moby-Dick (Unabridged):finished',
    ]);
    expect(summariseLoans(loans)).toEqual({ finished: 2, 'not-read': 0, 'in-progress': 1, unknown: 0 });
  });
});
