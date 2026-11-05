import { describe, expect, it } from 'vitest';
import { normaliseIsbn } from './isbn';
import { lookupIsbn, parseAudioMinutes, searchBooks } from './openLibrary';

describe('normaliseIsbn', () => {
  it('accepts valid ISBN-13 and converts ISBN-10', () => {
    expect(normaliseIsbn('978-0-14-143951-8')).toBe('9780141439518');
    expect(normaliseIsbn('0141439513')).toBe('9780141439518');
  });
  it('rejects bad checksums and non-book EANs', () => {
    expect(normaliseIsbn('9780141439519')).toBeNull();
    expect(normaliseIsbn('4006381333931')).toBeNull();
  });
});

// Fake fetch returning canned Open Library responses.
const fakeFetch = (routes: Record<string, unknown>): typeof fetch =>
  (async (url: string) => {
    const path = new URL(url).pathname;
    const body = routes[path];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body } as Response;
  }) as typeof fetch;

describe('openLibrary', () => {
  it('looks up an ISBN and resolves work and authors', async () => {
    const f = fakeFetch({
      '/isbn/9780000000001.json': {
        key: '/books/OL1M',
        title: 'Test Book',
        works: [{ key: '/works/OL9W' }],
        authors: [{ key: '/authors/OL5A' }],
        number_of_pages: 321,
        covers: [42],
      },
      '/works/OL9W.json': { key: '/works/OL9W', title: 'Test Book', subjects: ['Fiction'] },
      '/authors/OL5A.json': { name: 'Ann Author' },
    });
    expect(await lookupIsbn('9780000000001', f)).toEqual({
      title: 'Test Book',
      authors: ['Ann Author'],
      openLibraryWorkId: 'OL9W',
      openLibraryEditionId: 'OL1M',
      isbn: '9780000000001',
      pages: 321,
      pagesSource: 'open-library-edition',
      coverUrl: 'https://covers.openlibrary.org/b/id/42-M.jpg',
      coverUrls: ['https://covers.openlibrary.org/b/id/42-M.jpg'],
      subjects: ['Fiction'],
    });
  });

  it('returns null for an unknown ISBN', async () => {
    expect(await lookupIsbn('9780000000002', fakeFetch({}))).toBeNull();
  });

  it('maps search results', async () => {
    const f = fakeFetch({
      '/search.json': { docs: [{ key: '/works/OL2W', title: 'Found', author_name: ['B'], cover_i: 7, isbn: ['123', '9780000000003'] }] },
    });
    const [r] = await searchBooks('found', '', f);
    expect(r).toMatchObject({ title: 'Found', openLibraryWorkId: 'OL2W', isbn: '9780000000003' });
  });
});


it('parses explicit audiobook runtimes without mistaking discs or pages for time', () => {
  expect(parseAudioMinutes('9 audio discs (10 hr., 36 min.)')).toBe(636);
  expect(parseAudioMinutes('5 audio discs (5 1/2 hr.)')).toBe(330);
  expect(parseAudioMinutes('12 sound discs (ca. 13 hr.)')).toBe(780);
  expect(parseAudioMinutes('1 audio file (90 minutes)')).toBe(90);
  expect(parseAudioMinutes('9 audio discs')).toBeUndefined();
  expect(parseAudioMinutes('383 p.')).toBeUndefined();
  expect(parseAudioMinutes('12 discs (60 minutes each)')).toBeUndefined();
});

it('reads audio runtime from an edition, ignores erroneous audio page counts, and falls back to a work cover', async () => {
  const result = await lookupIsbn('9781543643626', fakeFetch({
    '/isbn/9781543643626.json': { key: '/books/OL26968555M', title: 'Scythe', physical_format: '[sound recording]', pagination: '9 audio discs (10 hr., 36 min.)', number_of_pages: 36, covers: [-1], works: [{ key: '/works/OL17876096W' }] },
    '/works/OL17876096W.json': { title: 'Scythe', covers: [42] },
  }));
  expect(result?.durationMinutes).toBe(636);
  expect(result?.pages).toBeUndefined();
  expect(result?.coverUrl).toContain('/42-M.jpg');
});

it('uses edition subjects when a work has none', async () => {
  const result = await lookupIsbn('9780141439518', fakeFetch({ '/isbn/9780141439518.json': { key: '/books/OL9M', title: 'Test Book', subjects: ['Fiction / Science fiction / General'] } }));
  expect(result?.subjects).toEqual(['Fiction / Science fiction / General']);
});
