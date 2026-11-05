import Papa from 'papaparse';
import { ImportError, type BookFormat, type EventType, type Importer, type RawEvent } from '../types';
import { runtimeMinutes } from '../metadata';

/**
 * Libby timeline importer.
 *
 * Libby → Shelf → Timeline → Actions → Export timeline gives either a CSV
 * ("Data (CSV)") or a JSON ("Data (JSON)") file. Both describe one activity per
 * row: a title, author, ISBN, timestamp, activity (Borrowed, Returned, ...),
 * library and format.
 *
 * Libby only tells us about loans, never whether a book was finished, so this
 * importer emits `borrowed`, `renewed` and `returned` events. Holds are skipped.
 * Activity labels Libby uses that we don't recognise are reported in a separate
 * warning, since that usually means the export format changed.
 *
 * The parser is deliberately tolerant about column names and timestamp shapes
 * because the export format is undocumented and may change.
 */

type Row = Record<string, unknown>;

/** Activity labels verified against a real export (2026-11), lowercased. */
const ACTIVITY_MAP: Record<string, EventType> = {
  borrowed: 'borrowed', // details: " 21 days " (loan length)
  renewed: 'renewed', // details: " 14 days " (new loan length)
  returned: 'returned', // details: " 6 days  early" | "on due date"
};

/** Labels we know about and skip on purpose: they say nothing about reading. */
const IGNORED_ACTIVITIES = new Set(['placed on hold', 'hold expired']);

/** Read a field by any of several candidate names, case-insensitively. Unwraps `{ text }` objects. */
function field(row: Row, ...names: string[]): string {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) lower[k.trim().toLowerCase()] = v;
  for (const name of names) {
    let v = lower[name.toLowerCase()];
    if (v && typeof v === 'object' && 'text' in (v as Row)) v = (v as Row).text;
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Accepts epoch milliseconds (JSON export), epoch seconds, Libby's CSV format
 * "September 28, 2026 22:40", or ISO strings. Returns ISO or null.
 *
 * The CSV format carries no timezone, but it is UTC: verified against the JSON
 * export of the same timeline, whose epoch timestamps match it exactly.
 */
export function parseLibbyTimestamp(raw: string): string | null {
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase()) && m[1].length >= 3);
    if (month < 0) return null;
    const d = new Date(Date.UTC(+m[3], month, +m[2], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Only accept other strings if they carry an explicit timezone (ISO with Z or offset).
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(raw.trim())) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Libby's `details` on a return reads " 6 days  early", "1 day early" or "on due date".
 * Returns days early (0 for on the due date), or undefined when unrecognised.
 */
export function parseDaysEarly(details: string): number | undefined {
  const d = details.replace(/\s+/g, ' ').trim().toLowerCase();
  if (d === 'on due date') return 0;
  const m = d.match(/^(\d+) days? early$/);
  return m ? Number(m[1]) : undefined;
}

/** Libby's `details` on a borrow or renewal reads " 21 days " (the loan length). */
export function parseLoanDays(details: string): number | undefined {
  const m = details.replace(/\s+/g, ' ').trim().toLowerCase().match(/^(\d+) days?$/);
  return m ? Number(m[1]) : undefined;
}

function mapFormat(raw: string): BookFormat | 'skip' | undefined {
  const f = raw.toLowerCase();
  if (!f) return undefined;
  if (f.includes('audio')) return 'audio';
  if (f.includes('magazine')) return 'skip';
  if (f.includes('ebook') || f.includes('e-book') || f.includes('kindle') || f.includes('book')) return 'ebook';
  return undefined;
}

function cleanIsbn(raw: string): string | undefined {
  const s = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  return s.length === 10 || s.length === 13 ? s : undefined;
}

/** Optional metadata is not present in every timeline export. Never use loan length. */
function bookMetadata(row: Row) {
  const fields = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().trim(), value]));
  const rawGenres = fields.genres ?? fields.genre ?? fields.subjects;
  const genres = (Array.isArray(rawGenres) ? rawGenres : typeof rawGenres === 'string' ? rawGenres.split(/[;|]/) : [])
    .flatMap((genre) => typeof genre === 'string' ? [genre.trim()] : genre && typeof genre === 'object' ? [field(genre as Row, 'name', 'text')] : []).filter(Boolean);
  const minutes = Number(field(row, 'durationMinutes', 'runningTimeMinutes'));
  const seconds = Number(field(row, 'durationSeconds', 'runningTimeSeconds'));
  const durationMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes
    : Number.isFinite(seconds) && seconds > 0 ? seconds / 60
      : runtimeMinutes(field(row, 'runningTime', 'runtime', 'duration'));
  return { ...(genres.length ? { genres } : {}), ...(durationMinutes ? { durationMinutes } : {}) };
}

function rowsFromText(text: string, fileName: string): Row[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new ImportError(`${fileName} is empty.`);

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new ImportError(`${fileName} looks like JSON but could not be read.`);
    }
    const list = Array.isArray(data) ? data : (data as Row).timeline;
    if (!Array.isArray(list)) {
      throw new ImportError(`${fileName} doesn't look like a Libby timeline export (no "timeline" list found).`);
    }
    return list as Row[];
  }

  const parsed = Papa.parse<Row>(trimmed, { header: true, skipEmptyLines: true });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim().toLowerCase());
  if (!headers.includes('title') || !headers.includes('activity')) {
    throw new ImportError(
      `${fileName} doesn't look like a Libby timeline export. Expected "title" and "activity" columns, found: ${headers.join(', ') || 'none'}.`,
    );
  }
  return parsed.data;
}

export const libbyImporter: Importer = {
  source: 'libby',
  label: 'Libby',
  howToExport:
    'In Libby, open Shelf → Timeline, make sure the filter shows all activity (not just returns), then tap Actions → Export Timeline and choose "Data (JSON)". JSON is preferred: the CSV export doesn\'t say whether a loan was an ebook or an audiobook.',
  accept: ['.csv', '.json'],

  parse(text, fileName) {
    const rows = rowsFromText(text, fileName);
    const events: RawEvent[] = [];
    const warnings: string[] = [];
    const unknownActivities = new Map<string, number>();
    let magazines = 0;
    let badRows = 0;

    rows.forEach((row) => {
      const activityRaw = field(row, 'activity', 'action', 'event');
      const activity = activityRaw.replace(/\s+/g, ' ').toLowerCase();
      if (IGNORED_ACTIVITIES.has(activity)) return;
      const type = ACTIVITY_MAP[activity];
      if (!type) {
        const key = activityRaw || '(blank)';
        unknownActivities.set(key, (unknownActivities.get(key) ?? 0) + 1);
        return;
      }

      // The JSON export nests the format under `cover` ({ cover: { format: "audiobook" } }).
      const cover = row.cover && typeof row.cover === 'object' ? (row.cover as Row) : {};
      const format = mapFormat(field(row, 'format', 'type', 'mediaType') || field(cover, 'format'));
      if (format === 'skip') {
        magazines++;
        return;
      }

      const rawTitle = field(row, 'title', 'titleText');
      const timestamp = parseLibbyTimestamp(field(row, 'timestamp', 'date', 'time'));
      if (!rawTitle || !timestamp) {
        badRows++;
        return;
      }

      const titleObj = (row as Row).title;
      const sourceItemId =
        field(row, 'titleId', 'id') ||
        (titleObj && typeof titleObj === 'object' ? field(titleObj as Row, 'titleId', 'id') : '') ||
        undefined;

      const details = field(row, 'details');
      events.push({
        source: 'libby',
        type,
        rawTitle,
        rawAuthor: field(row, 'author', 'creator', 'authors'),
        timestamp,
        format,
        ...bookMetadata(row),
        isbn: cleanIsbn(field(row, 'isbn')),
        sourceItemId,
        extra: {
          library: field(row, 'library', 'libraryName') || undefined,
          publisher: field(row, 'publisher') || undefined,
          details: details || undefined,
          // How early a loan was returned: a hint for the review inbox (early return may mean abandoned).
          daysEarly: type === 'returned' ? parseDaysEarly(details) : undefined,
          // Loan length granted on a borrow or renewal; tells phase 2 when the loan would have ended.
          loanDays: type !== 'returned' ? parseLoanDays(details) : undefined,
          coverUrl: field(cover, 'url') || (typeof row.cover === 'string' ? row.cover.trim() : field(row, 'coverUrl')) || undefined,
        },
      });
    });

    if (unknownActivities.size) {
      const list = [...unknownActivities].map(([a, n]) => `"${a}" (${n})`).join(', ');
      warnings.push(`Skipped activity types Bookend doesn't recognise: ${list}. Libby may have changed its export format.`);
    }
    if (magazines) warnings.push(`Skipped ${magazines} magazine row(s).`);
    if (badRows) warnings.push(`Skipped ${badRows} row(s) with a missing title or unreadable date.`);
    if (!events.length) warnings.push('No borrow or return activity was found in this file.');
    const noFormat = events.filter((e) => !e.format).length;
    if (noFormat) {
      warnings.push(
        `${noFormat} loan(s) don't say whether they were an ebook or audiobook (the CSV export leaves this out). Use the JSON export to get formats.`,
      );
    }
    if (events.length && !events.some((e) => e.type === 'borrowed')) {
      warnings.push('This file only has returns, no borrows. If your timeline was filtered, export it again showing all activity.');
    }

    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return { events, warnings };
  },
};

export default libbyImporter;

