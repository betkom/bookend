/**
 * The importer contract.
 *
 * An importer is a small, self-contained module that turns one user-downloaded
 * export file into a list of raw reading events. It does NOT match books, talk
 * to the network or touch storage: matching to a Work happens after import.
 *
 * To add a source, create `importers/<source>/index.ts` exporting an `Importer`,
 * add an anonymised sample to `fixtures/<source>/` and a test next to the importer.
 * See CONTRIBUTING.md.
 */

export type SourceId = 'libby' | 'paper' | 'audible' | 'spotify';

export type BookFormat = 'paper' | 'ebook' | 'audio';

/**
 * The plan lists borrowed, listened, progress and finished. `started` (paper
 * start dates), `returned` and `renewed` (Libby loans) are added because those
 * sources report them and the merge step needs them to build reading windows.
 * A renewal is also evidence the reader was still going.
 */
export type EventType = 'borrowed' | 'renewed' | 'returned' | 'started' | 'listened' | 'progress' | 'finished';

/** One raw fact produced by an importer, before it is stored. */
export interface RawEvent {
  source: SourceId;
  type: EventType;
  rawTitle: string;
  rawAuthor: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /**
   * Type-specific number: minutes for `listened`, 0–1 fraction for `progress`.
   * Omitted when not meaningful.
   */
  value?: number;
  format?: BookFormat;
  /** Genres supplied by the export, preferred over catalogue metadata. */
  genres?: string[];
  /** Full audiobook runtime in minutes, not actual time listened. */
  durationMinutes?: number;
  isbn?: string;
  asin?: string;
  /** Stable id of the item in the source system, if any (e.g. Libby/OverDrive title id). */
  sourceItemId?: string;
  /** Anything else worth keeping for evidence in the review inbox. */
  extra?: Record<string, string | number | boolean | undefined>;
}

export interface ImportResult {
  events: RawEvent[];
  /** Non-fatal problems, e.g. skipped rows. Shown to the user after import. */
  warnings: string[];
}

export interface Importer {
  source: SourceId;
  /** Human-readable name shown in the UI. */
  label: string;
  /** Short instructions telling the user how to get the export file. */
  howToExport: string;
  /** File extensions accepted, e.g. ['.csv', '.json']. */
  accept: string[];
  /** Parse the file's text. Throw `ImportError` when the file is unusable. */
  parse(text: string, fileName: string): ImportResult;
}

/** Thrown when a file cannot be imported at all. The message is shown to the user. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

