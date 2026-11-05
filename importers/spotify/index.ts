import { ImportError, type Importer, type RawEvent } from '../types';

type Row = Record<string, unknown>;
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

const has = (row: Row, key: string) => Object.prototype.hasOwnProperty.call(row, key);
const audiobookFields = ['audiobook_title', 'audiobook_uri', 'audiobook_chapter_uri', 'audiobook_chapter_title'];
const mediaFields = [...audiobookFields, 'spotify_track_uri', 'spotify_episode_uri', 'master_metadata_track_name', 'episode_name'];

/** Spotify's extended export uses ISO timestamps with an explicit timezone. */
function timestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const monthNumber = Number(month); const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > new Date(Date.UTC(Number(year), monthNumber, 0)).getUTCDate()) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

export const spotifyImporter: Importer = {
  source: 'spotify',
  label: 'Spotify',
  howToExport: 'In your Spotify account privacy settings, request Extended streaming history. Unzip the download and import its Streaming_History_*.json files one at a time. Only rows with audiobook details are included; music and podcasts are skipped. In Recap, books automatically count as finished when listening reaches their runtime minus five minutes. Review books with unknown runtimes or less listening there.',
  accept: ['.json'],
  parse(text, fileName) {
    let data: unknown;
    try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new ImportError(`${fileName} is not valid JSON. Choose a Spotify extended streaming history JSON file from the unzipped download.`); }
    if (!Array.isArray(data)) throw new ImportError(`${fileName} does not look like Spotify extended streaming history. Expected a JSON array of playback records.`);
    const recognized = (row: unknown) => object(row) && has(row, 'ts') && has(row, 'ms_played') && mediaFields.some((key) => has(row, key));
    if (data.length && !data.some(recognized)) throw new ImportError(`${fileName} does not look like Spotify extended streaming history. Expected ts, ms_played, and audiobook, music, or podcast fields. The basic streaming history export is not supported.`);

    const events: RawEvent[] = [];
    const warnings: string[] = [];
    let otherMedia = 0; let invalid = 0; let zeroTime = 0; let missingTitle = 0; let missingId = 0;
    for (const row of data) {
      if (!recognized(row)) { invalid++; continue; }
      const record = row as Row;
      // Dedicated audiobook fields are the evidence: podcast episodes and music albums are never guessed to be books.
      if (!audiobookFields.some((key) => string(record[key]))) { otherMedia++; continue; }
      const title = string(record.audiobook_title);
      if (!title) { missingTitle++; continue; }
      const at = timestamp(record.ts);
      const msPlayed = record.ms_played;
      if (!at || typeof msPlayed !== 'number' || !Number.isFinite(msPlayed) || msPlayed < 0 || !Number.isSafeInteger(msPlayed)) { invalid++; continue; }
      if (msPlayed === 0) { zeroTime++; continue; }
      const bookUri = string(record.audiobook_uri);
      // Verified audio exports use spotify:show: for books and spotify:episode: for chapters.
      // Keep IDs opaque; audiobook_title, not the URI namespace, distinguishes books from podcasts.
      if (!bookUri) missingId++;
      const chapterUri = string(record.audiobook_chapter_uri);
      const chapterTitle = string(record.audiobook_chapter_title);
      const extra: RawEvent['extra'] = {};
      if (chapterUri) extra.chapterUri = chapterUri;
      if (chapterTitle) extra.chapterTitle = chapterTitle;
      // Keep positive listening time even when a chapter was skipped. "trackdone" only ends a chapter, not a book.
      events.push({ source: 'spotify', type: 'listened', format: 'audio', rawTitle: title, rawAuthor: '',
        timestamp: at, value: msPlayed / 60000, sourceItemId: bookUri || undefined,
        ...(Object.keys(extra).length ? { extra } : {}) });
    }
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (otherMedia) warnings.push(`Skipped ${otherMedia} music, podcast, or other records without audiobook details.`);
    if (invalid) warnings.push(`Skipped ${invalid} malformed records or audiobook sessions with an invalid timestamp or milliseconds played.`);
    if (missingTitle) warnings.push(`Skipped ${missingTitle} audiobook records without a book title. Chapter titles are not used as book titles.`);
    if (zeroTime) warnings.push(`Skipped ${zeroTime} audiobook plays with zero listening time.`);
    if (missingId) warnings.push(`${missingId} audiobook sessions have no book URI. Their title is retained for later matching.`);
    if (events.length) warnings.push('This Spotify export does not provide audiobook authors or full runtimes. Only the recorded listening minutes are imported. Recap looks up runtimes and counts books as finished at runtime minus five minutes; other books need review.');
    else warnings.push('No usable audiobook listening was found. If this file contains only music or podcasts, try another JSON file from your Extended streaming history download.');
    return { events, warnings };
  },
};
