import { expect, it } from 'vitest';
import { buildRecap, type RecapEntry } from './data';
import { buildCards, themes } from './cards';

function read(id: string, authors: string[], genres: string[], date = '2026-05-01', status: RecapEntry['status'] = 'finished'): RecapEntry {
  return { id, workId: id, work: { id, title: id, authors, genres }, status, finishedAt: date, formats: ['paper'], editions: [], sources: ['paper'] };
}

it('ranks authors across formats, credits coauthors once per read and merges case/spacing variants', () => {
  const entries = [read('one', [' Ursula  K. Le Guin ', 'ursula k. le guin', 'Octavia Butler'], ['Fantasy']),
    { ...read('two', ['Ursula K. Le Guin'], ['Science fiction']), formats: ['audio'] as const },
    read('three', ['Octavia Butler'], ['Science fiction']), read('four', ['Ted Chiang'], ['Science fiction'])];
  const stats = buildRecap(entries.map((entry) => ({ ...entry, formats: [...entry.formats] })), { year: 2026 });
  expect(stats.authors).toEqual([['Octavia Butler', 2], ['Ursula K. Le Guin', 2], ['Ted Chiang', 1]]);
  expect(stats.uniqueAuthors).toBe(3);
  expect(stats.newAuthors).toEqual(['Octavia Butler', 'Ted Chiang', 'Ursula K. Le Guin']);
  expect(stats.uniqueGenres).toBe(2);
  expect(stats.newGenres).toEqual(['Fantasy', 'Science fiction']);
});

it('finds discoveries against finished history, ignoring future, abandoned and unread books', () => {
  const entries = [read('old', ['Known Author'], ['Fantasy'], '2025-12-31'),
    read('abandoned', ['New Author'], ['Poetry'], '2025-01-01', 'abandoned'),
    read('not-read', ['New Author'], ['Poetry'], '2025-02-01', 'not-read'),
    read('current', ['Known Author', 'New Author'], ['Poetry']),
    read('repeat', ['new author'], ['poems']),
    read('future', ['New Author'], ['Poetry'], '2027-01-01')];
  expect(buildRecap(entries, { year: 2026 })).toMatchObject({ uniqueAuthors: 2, newAuthors: ['New Author'], uniqueGenres: 1, newGenres: ['Poetry'] });
  expect(buildRecap(entries, { year: 2027 })).toMatchObject({ uniqueAuthors: 1, newAuthors: [], newGenres: [] });
});

it('uses quarter boundaries in UTC and counts annual discoveries only once', () => {
  const entries = [read('q1', ['Earlier Author'], ['Fantasy'], '2026-03-31T23:59:59Z'),
    read('q2', ['Earlier Author', 'New Author'], ['Poetry'], '2026-03-31T23:30:00-01:00'),
    read('again', ['New Author'], ['Poetry'], '2026-06-01')];
  expect(buildRecap(entries, { year: 2026, quarter: 1 })).toMatchObject({ uniqueAuthors: 1, newAuthors: ['Earlier Author'], newGenres: ['Fantasy'] });
  expect(buildRecap(entries, { year: 2026, quarter: 2 })).toMatchObject({ uniqueAuthors: 2, newAuthors: ['New Author'], newGenres: ['Poetry'] });
  expect(buildRecap(entries, { year: 2026 })).toMatchObject({ uniqueAuthors: 2, newAuthors: ['Earlier Author', 'New Author'], newGenres: ['Fantasy', 'Poetry'] });
});

it('excludes missing metadata from discoveries without merging distinct accented names', () => {
  const entries = [read('missing', ['', ' ', 'Unknown Author'], []),
    read('one', ['Jose Author', 'José Author'], ['Cozy mystery']),
    read('old', ['JOSE AUTHOR'], [], '2025-01-01')];
  expect(buildRecap(entries, { year: 2026 })).toMatchObject({ uniqueAuthors: 2, newAuthors: ['José Author'], uniqueGenres: 1, newGenres: ['Cozy mystery'] });
  expect(buildRecap([], { year: 2026 })).toMatchObject({ authors: [], uniqueAuthors: 0, newAuthors: [], uniqueGenres: 0, newGenres: [] });
});

it('exports authors and discoveries in both palettes without the narrator card or calculation notes', () => {
  const stats = buildRecap([read('one', ['Author <One> & Co'], ['Fantasy'])], { year: 2026 });
  for (const theme of themes) {
    const cards = buildCards(stats, theme);
    expect(cards.map((card) => card.id)).toEqual(['formats', 'genres', 'authors', 'discoveries', 'busiest', 'covers-1', 'total', 'summary']);
    expect(cards.some((card) => card.id === 'narrators')).toBe(false);
    expect(cards.find((card) => card.id === 'authors')?.svg).toContain('Author &lt;One&gt; &amp; Co');
    const discovery = cards.find((card) => card.id === 'discoveries')!;
    expect(discovery.svg).toContain('unique authors'); expect(discovery.svg).toContain('new genres');
    expect(discovery.svg).not.toMatch(/undefined|NaN|One genre per read|y="1810"[^>]*>Bookend</);
  }
});
