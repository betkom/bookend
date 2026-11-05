import { runtimeMinutes } from '@importers/metadata';

/**
 * Open Library client for ISBN, edition and work metadata, and title search.
 * Responses are cached in memory per session; recap enrichment also saves
 * metadata in IndexedDB. Libby runtimes use its own catalogue client.
 */

const OL = 'https://openlibrary.org';
const COVERS = 'https://covers.openlibrary.org';

export interface BookCandidate {
  title: string;
  authors: string[];
  openLibraryWorkId?: string; // e.g. "OL45883W"
  openLibraryEditionId?: string; // e.g. "OL7353617M"
  isbn?: string;
  pages?: number;
  pagesSource?: 'open-library-edition' | 'open-library-median';
  durationMinutes?: number;
  durationSource?: 'open-library-edition' | 'open-library-work';
  coverUrl?: string;
  coverUrls?: string[];
  firstPublishYear?: number;
  subjects?: string[];
}

const caches = new WeakMap<typeof fetch, Map<string, Promise<unknown>>>();
let nextRequestAt = 0;

export function clearBookMetadataCache() { caches.delete(fetch); }

async function getJson<T>(url: string, fetchFn: typeof fetch = fetch): Promise<T | null> {
  let cache = caches.get(fetchFn);
  if (!cache) { cache = new Map(); caches.set(fetchFn, cache); }
  if (!cache.has(url)) {
    cache.set(
      url,
      (async () => {
        // Open Library's public API is intended for low-volume requests.
        if (fetchFn === globalThis.fetch) {
          const now = Date.now(); const wait = Math.max(0, nextRequestAt - now);
          nextRequestAt = Math.max(now, nextRequestAt) + 1100;
          if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        }
        return fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      })().then(async (r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`Open Library returned ${r.status}`);
        return r.json();
      }),
    );
  }
  try {
    return (await cache.get(url)) as T | null;
  } catch (e) {
    cache.delete(url); // don't cache failures
    throw e;
  }
}

const olKey = (key?: string) => key?.split('/').pop();

export const coverUrlForId = (coverId?: number, size: 'S' | 'M' | 'L' = 'M') =>
  coverId && coverId > 0 ? `${COVERS}/b/id/${coverId}-${size}.jpg` : undefined;

export async function lookupWorkCovers(workId: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  if (!/^OL\d+W$/.test(workId)) return [];
  const work = await getJson<OLWork>(`${OL}/works/${workId}.json`, fetchFn);
  return [...new Set((work?.covers ?? []).flatMap((id) => coverUrlForId(id) ?? []))];
}

export async function lookupEditionCovers(editionId: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  if (!/^OL\d+M$/.test(editionId)) return [];
  const edition = await getJson<OLEdition>(`${OL}/books/${editionId}.json`, fetchFn);
  return [...new Set((edition?.covers ?? []).flatMap((id) => coverUrlForId(id) ?? []))];
}

interface OLEdition {
  key: string;
  title: string;
  works?: { key: string }[];
  authors?: { key: string }[];
  number_of_pages?: number;
  covers?: number[];
  isbn_13?: string[];
  isbn_10?: string[];
  pagination?: string;
  physical_format?: string;
  subjects?: string[];
}
interface OLWork {
  key: string;
  title: string;
  authors?: { author: { key: string } }[];
  subjects?: string[];
  covers?: number[];
}
interface OLAuthor {
  name: string;
}

/** Look up an edition by ISBN and fill in its work and author names. */
export async function lookupIsbn(isbn: string, fetchFn: typeof fetch = fetch): Promise<BookCandidate | null> {
  const ed = await getJson<OLEdition>(`${OL}/isbn/${isbn}.json`, fetchFn);
  if (!ed) return null;
  return editionCandidate(ed, isbn, fetchFn);
}

/** Read the exact edition already associated with a book. */
export async function lookupEdition(id: string, fetchFn: typeof fetch = fetch): Promise<BookCandidate | null> {
  if (!/^OL\d+M$/.test(id)) return null;
  const ed = await getJson<OLEdition>(`${OL}/books/${id}.json`, fetchFn);
  return ed ? editionCandidate(ed, ed.isbn_13?.[0] ?? ed.isbn_10?.[0], fetchFn) : null;
}

/** A work-level audio estimate is safe only when the available runtimes agree. */
export async function lookupAudioRuntime(workId: string, fetchFn: typeof fetch = fetch): Promise<number | undefined> {
  if (!/^OL\d+W$/.test(workId)) return undefined;
  const result = await getJson<{ entries: OLEdition[]; size: number }>(`${OL}/works/${workId}/editions.json?limit=100`, fetchFn);
  if (!result || result.size > result.entries.length) return undefined;
  const runtimes = new Set(result.entries.filter((ed) => /audio|sound|disc|cassette/i.test(`${ed.physical_format ?? ''} ${ed.pagination ?? ''}`))
    .map((ed) => parseAudioMinutes(ed.pagination)).filter((n): n is number => n !== undefined));
  return runtimes.size === 1 ? [...runtimes][0] : undefined;
}

/** Only parse explicit runtime units; disc counts and page counts are not durations. */
export function parseAudioMinutes(pagination?: string): number | undefined {
  return pagination ? runtimeMinutes(pagination) : undefined;
}

async function editionCandidate(ed: OLEdition, isbn: string | undefined, fetchFn: typeof fetch): Promise<BookCandidate> {
  const workKey = ed.works?.[0]?.key;
  const work = workKey ? await getJson<OLWork>(`${OL}${workKey}.json`, fetchFn) : null;
  const authorKeys = ed.authors?.map((a) => a.key) ?? work?.authors?.map((a) => a.author.key) ?? [];
  const authors = (
    await Promise.all(authorKeys.slice(0, 5).map((k) => getJson<OLAuthor>(`${OL}${k}.json`, fetchFn).catch(() => null)))
  )
    .filter((a): a is OLAuthor => !!a)
    .map((a) => a.name);

  const audio = /audio|sound|disc|cassette/i.test(`${ed.physical_format ?? ''} ${ed.pagination ?? ''}`);
  const coverUrls = [...new Set([...(ed.covers ?? []), ...(work?.covers ?? [])].flatMap((id) => coverUrlForId(id) ?? []))];
  return {
    title: ed.title || work?.title || '',
    authors,
    openLibraryWorkId: olKey(workKey),
    openLibraryEditionId: olKey(ed.key),
    isbn,
    pages: !audio ? ed.number_of_pages : undefined,
    pagesSource: !audio && ed.number_of_pages ? 'open-library-edition' : undefined,
    durationMinutes: audio ? parseAudioMinutes(ed.pagination) : undefined,
    durationSource: audio && parseAudioMinutes(ed.pagination) ? 'open-library-edition' : undefined,
    coverUrl: coverUrls[0],
    coverUrls,
    subjects: (work?.subjects?.length ? work.subjects : ed.subjects)?.slice(0, 100),
  };
}

interface OLSearchDoc {
  key: string;
  title: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  number_of_pages_median?: number;
  isbn?: string[];
  cover_edition_key?: string;
  subject?: string[];
}

/** Title (and optional author) search, for books without a scannable barcode. */
export async function searchBooks(title: string, author = '', fetchFn: typeof fetch = fetch): Promise<BookCandidate[]> {
  const params = new URLSearchParams({
    title,
    limit: '10',
    fields: 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,isbn,cover_edition_key,subject',
  });
  if (author) params.set('author', author);
  const res = await getJson<{ docs: OLSearchDoc[] }>(`${OL}/search.json?${params}`, fetchFn);
  return (res?.docs ?? []).map((d) => ({
    title: d.title,
    authors: d.author_name ?? [],
    openLibraryWorkId: olKey(d.key),
    openLibraryEditionId: d.cover_edition_key,
    isbn: d.isbn?.find((i) => i.length === 13),
    pages: d.number_of_pages_median,
    pagesSource: d.number_of_pages_median ? 'open-library-median' : undefined,
    coverUrl: coverUrlForId(d.cover_i),
    firstPublishYear: d.first_publish_year,
    subjects: d.subject?.slice(0, 100),
  }));
}

