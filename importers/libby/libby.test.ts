import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { libbyImporter, parseDaysEarly, parseLibbyTimestamp, parseLoanDays } from './index';
import { ImportError } from '../types';

const fixtureDir = fileURLToPath(new URL('../../fixtures/libby/', import.meta.url));
const fixture = (name: string) => readFileSync(fixtureDir + name, 'utf8');

describe('libby importer — CSV (synthetic, real column layout)', () => {
  const { events, warnings } = libbyImporter.parse(fixture('synthetic-timeline.csv'), 'synthetic-timeline.csv');

  it('keeps borrows, renewals and returns, oldest first; drops holds', () => {
    expect(events.map((e) => `${e.type}:${e.rawTitle}`)).toEqual([
      'borrowed:Pride and Prejudice',
      'returned:Pride and Prejudice',
      'borrowed:No Isbn Book',
      'borrowed:Moby-Dick (Unabridged)',
      'renewed:Moby-Dick (Unabridged)',
      'returned:Moby-Dick (Unabridged)',
    ]);
  });

  it('maps fields; CSV timestamps are UTC', () => {
    expect(events[0]).toMatchObject({
      source: 'libby',
      rawAuthor: 'Jane Austen',
      isbn: '9780141439518',
      timestamp: '2024-01-08T10:00:00.000Z',
    });
    expect(events[0].format).toBeUndefined(); // the CSV export has no format column
    expect(events[0].extra?.library).toBe('Sample Library');
    expect(events[2].isbn).toBeUndefined();
  });

  it('reads loan length on borrows/renewals and days early on returns', () => {
    expect(events[0].extra).toMatchObject({ loanDays: 21, daysEarly: undefined });
    expect(events[1].extra).toMatchObject({ daysEarly: 0, loanDays: undefined }); // "on due date"
    expect(events[4].extra?.loanDays).toBe(14); // renewal
    expect(events[5].extra?.daysEarly).toBe(2); // " 2 days  early"
  });

  it('skips holds silently and warns only about the missing formats', () => {
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^6 loan\(s\) don't say whether/);
  });
});

describe('libby importer — unknown activity labels', () => {
  it('warns that the format may have changed', () => {
    const csv = 'title,author,timestamp,activity,details\nX,Y,"May 01, 2026 10:00",Borrowed, 21 days \nX,Y,"May 02, 2026 10:00",Tagged,\nX,Y,"May 03, 2026 10:00",Tagged,';
    const { events, warnings } = libbyImporter.parse(csv, 'x.csv');
    expect(events).toHaveLength(1);
    expect(warnings).toContain('Skipped activity types Bookend doesn\'t recognise: "Tagged" (2). Libby may have changed its export format.');
  });
});

describe('libby importer — JSON', () => {
  const { events, warnings } = libbyImporter.parse(fixture('synthetic-timeline.json'), 'synthetic-timeline.json');

  it('unwraps title objects and reads the title id', () => {
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ rawTitle: 'Pride and Prejudice', sourceItemId: '1001', type: 'borrowed', format: 'ebook' });
    expect(events[0].extra?.library).toBe('Sample Public Library');
  });

  it('skips magazines', () => {
    expect(warnings).toContain('Skipped 1 magazine row(s).');
  });
});

describe('libby importer — errors', () => {
  it('rejects a CSV without the expected columns', () => {
    expect(() => libbyImporter.parse('name,date\nfoo,bar', 'wrong.csv')).toThrow(ImportError);
  });
  it('rejects an empty file', () => {
    expect(() => libbyImporter.parse('  ', 'empty.csv')).toThrow(/empty/);
  });
  it('rejects JSON without a timeline', () => {
    expect(() => libbyImporter.parse('{"foo":1}', 'x.json')).toThrow(/timeline/);
  });
});

describe('parseDaysEarly', () => {
  it('handles Libby phrasing', () => {
    expect(parseDaysEarly(' 6 days  early')).toBe(6);
    expect(parseDaysEarly(' 1 day  early')).toBe(1);
    expect(parseDaysEarly('on due date')).toBe(0);
    expect(parseDaysEarly('21 days')).toBeUndefined();
  });
});

describe('parseLoanDays', () => {
  it('handles Libby phrasing', () => {
    expect(parseLoanDays(' 21 days ')).toBe(21);
    expect(parseLoanDays(' 1 day ')).toBe(1);
    expect(parseLoanDays(' 6 days  early')).toBeUndefined();
  });
});

describe('parseLibbyTimestamp', () => {
  it('handles ms, seconds and date strings', () => {
    expect(parseLibbyTimestamp('1704708000000')).toBe('2024-01-08T10:00:00.000Z');
    expect(parseLibbyTimestamp('1704708000')).toBe('2024-01-08T10:00:00.000Z');
    expect(parseLibbyTimestamp('2024-01-08T10:00:00Z')).toBe('2024-01-08T10:00:00.000Z');
    expect(parseLibbyTimestamp('not a date')).toBeNull();
  });

  it('reads Libby CSV dates as UTC, whatever the machine timezone', () => {
    expect(parseLibbyTimestamp('September 28, 2026 22:40')).toBe('2026-09-28T22:40:00.000Z');
    expect(parseLibbyTimestamp('June 01, 2026 02:14')).toBe('2026-06-01T02:14:00.000Z');
    expect(parseLibbyTimestamp('Smarch 01, 2026 02:14')).toBeNull();
  });
});

it('keeps optional recorded genres and audiobook runtime without turning loan length into listening time', () => {
  const json = JSON.stringify({ timeline: [
    { title: 'Book', author: 'Author', activity: 'Borrowed', timestamp: '2026-01-01T00:00:00Z', format: 'audiobook', genres: ['Fantasy'], durationMinutes: 480, details: '21 days' },
    { title: 'Book 2', activity: 'Returned', timestamp: '2026-01-02T00:00:00Z', format: 'audiobook', genre: 'Memoir', runningTime: '10:36:00' },
    { title: 'Book 3', activity: 'Borrowed', timestamp: '2026-01-03T00:00:00Z', format: 'audiobook', durationSeconds: 7200 },
    { title: 'Book 4', activity: 'Borrowed', timestamp: '2026-01-04T00:00:00Z', format: 'audiobook', duration: 21, details: '21 days' },
  ] });
  const { events } = libbyImporter.parse(json, 'optional-metadata.json');
  expect(events[0]).toMatchObject({ genres: ['Fantasy'], durationMinutes: 480 });
  expect(events[1]).toMatchObject({ genres: ['Memoir'], durationMinutes: 636 });
  expect(events[2].durationMinutes).toBe(120);
  expect(events[3].durationMinutes).toBeUndefined();
  expect(events.every((event) => event.type !== 'listened')).toBe(true);
});

it('preserves cover URLs from both CSV and JSON exports', () => {
  const url = 'https://img3.od-cdn.com/ImageType-100/example.JPG';
  const csv = `title,author,activity,timestamp,cover\nBook,Author,Borrowed,"January 01, 2026 10:00",${url}`;
  expect(libbyImporter.parse(csv, 'covers.csv').events[0].extra?.coverUrl).toBe(url);
  const json = JSON.stringify({ timeline: [{ title: 'Book', author: 'Author', activity: 'Borrowed', timestamp: '2026-01-01T10:00:00Z', cover: { url, format: 'audiobook' } }] });
  expect(libbyImporter.parse(json, 'covers.json').events[0].extra?.coverUrl).toBe(url);
});
