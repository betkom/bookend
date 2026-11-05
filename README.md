# Bookend

Every book you read or heard, in one log. Bookend merges your reading history from
paper books, Libby, Audible and Spotify, then turns it into shareable quarterly and
yearly recaps.

- **Local-first and private.** Everything stays in your browser (IndexedDB). No account.
- **Import files, not logins.** You download your own exports; Bookend never sees a password.
- **Small, pluggable importers.** Each source is one self-contained module.
- **Open data.** Book metadata comes from [Open Library](https://openlibrary.org).

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | App shell, storage, importer contract, Libby importer, paper books (scan/search), backup | ✅ in progress |
| 2 | Matching to Open Library works, cross-format merge, review inbox | Partially implemented: ISBN/title matching and Libby/Spotify review are available; full cross-format merging and a unified matching/merge inbox remain planned |
| 3 | Quarterly/yearly recap cards (1080×1920) and sharing | ✅ implemented |
| 4 | Audible importer (audible-cli export) | planned |
| 5 | Spotify importer (extended streaming history) | ✅ importer, runtime-based completion, and review implemented |

## Getting started

```sh
npm install
npm run dev     # http://localhost:5173
npm test        # Vitest, including all fixtures
npm run build   # static PWA in dist/
npm run try-import -- <export file> --source spotify   # or --source libby
```

Requires Node 20+.

## Repo layout

```
app/                 React + Vite PWA
  src/db.ts          Dexie schema: Work, Edition, Event, Read, ImportBatch
  src/importService  store/undo imports, add paper books
  src/openLibrary.ts ISBN lookup and title search
  src/views/         Log, Import, Add book, Data (backup + undo)
importers/
  types.ts           the importer contract
  libby/             Libby timeline importer + tests
  spotify/           Spotify extended streaming history importer + tests
fixtures/<source>/   synthetic exports used as regression tests
themes/              recap card palettes (Playful, Ink)
```

## Design system

The app follows the supplied Playful reference: a light oat canvas, white cards,
heavy italic Inter, pill controls, black navigation, and hot magenta actions.
Inter is bundled locally and embedded into exported cards. Recaps use Playful
by default, with an optional Ink palette. See [app/DESIGN.md](app/DESIGN.md) for
shared tokens, responsive rules, and font licensing.

## Spotify imports

Choose **Spotify** in Import and select a JSON file from your unzipped **Extended
streaming history** download. Import files separately. Audiobook rows use the
`audiobook_title` as the book title, `audiobook_uri` as its source identity, and
`ms_played` as actual listening time. Chapter details are retained as evidence.
Music and podcasts are skipped, along with zero-time plays. Positive listening
still counts if a chapter was skipped; a chapter ending never confirms a book finish.

In Recap, sessions are grouped by audiobook URI across imported history. Overlapping
exports count each play once. Open Library looks for missing metadata; use the
book review to choose an exact ISBN match or enter your edition's full runtime.
The export itself supplies neither author nor runtime.

A book automatically counts as finished once listening time reaches **runtime minus
five minutes**, including totals above runtime. The first and last listening dates
supply its default start and finish dates; the finish date determines its recap
period. Books below the threshold or without runtime need review. Explicit
Finished, Abandoned, or Did not read choices override automatic completion and can
be reset. Automatic results recalculate when metadata or imported evidence changes.
Replays are included in the total; each audiobook URI counts once, so separate
re-reads of the same Spotify edition are not currently distinguished. Playback
speed and incomplete history can affect the comparison. Playback IPs, device
details, and location are discarded.

The importer has been checked against a real audio export containing audiobook
activity. Synthetic fixtures mirror its `spotify:show:` book URIs,
`spotify:episode:` chapter URIs, and nullable chapter titles without copying
private records. See [fixtures/spotify/README.md](fixtures/spotify/README.md).

## Recaps

Open **Recap** and choose a year or quarter, theme and card. Save each card as a
1080 × 1920 PNG, or share it through your device's share sheet. Browsers without
file sharing download the image instead. Everything is rendered on-device.

Paper entries with finish dates count automatically. In **Confirm Libby reads**,
mark loans Finished or Abandoned and enter the actual date, or choose Did not read
for books you never started. Did not read marks the loan reviewed without requiring
reading dates or adding to finished or abandoned totals. Return dates are only
suggestions; automatic loan estimates never enter a recap. Start dates are optional.
Confirmations survive backup/restore and are removed when their import is undone.
Re-reading a book counts again. Mixed-format confirmed Reads count once overall
and in each format, so format percentages can add up to more than 100%.

Cards include totals, formats/services, time, genres, top authors, discoveries, Libby borrowing,
highlights and every cover (paginated). Recap automatically looks up missing book
details in Open Library, by ISBN/edition first and then an unambiguous title/author
match. Existing covers and manually entered page counts are preserved. Metadata
is saved locally and checked at most weekly; **Refresh covers & book details**
retries immediately. **Review missing book details** lists the specific missing
fields. Its match search tries saved ISBNs first, and you can enter a corrected
ISBN-10 or ISBN-13 to look up the exact edition. Title search is available when an
ISBN is unknown or absent from Open Library. An exact match can still lack optional
metadata. Once you choose a match (or click **Keep this match**), the book leaves
the review list and stays editable under **Matched books**, including after
backup/restore. Genre priority is the read's recorded genres, then its imported
records, then the book's saved genres. Only when none is recorded do we map Open
Library subjects into recap genres, including hierarchical tags such as Fiction /
Fantasy / Epic. Catalogue subjects are stored separately, and custom recorded
genres are retained even when absent from the genre mapping.

Exact edition page counts are preferred; work-level page medians are labelled as
estimates. Audio hours prefer a read's recorded listening minutes, then the sum of
its imported listening sessions. When neither is available, the imported audiobook
runtime (if supplied) or catalogue runtime estimates the hours for finished books.
Libby audiobooks fetch runtime directly from the public OverDrive catalogue using
the imported title ID, preferring the OverDrive Listen format. This also backfills
previously confirmed reads without re-importing. Source runtimes take priority over
Open Library estimates; manual runtimes and recorded listening minutes are preserved.
Only the title ID is sent, with no account credentials or loan history. Results are
saved locally; refresh book details to retry unavailable titles. Unknown audio hours
are shown as unavailable rather than a measured zero.
This applies to Libby and all other importers; zero recorded minutes is a known
value, not missing data. Estimates are labelled on time cards. Open Library
only has runtimes for some audio editions. Without an exact edition, a work-level
runtime is used only if the returned audio runtimes agree and the edition list is
complete. Missing metadata is never inferred from loan duration. Full cross-format
merging remains phase 2 work. Genre mapping is editable in
`app/src/recap/genres.json`.

Top authors rank by finished reads in the selected period, with each coauthor
credited once per read. Discoveries shows unique authors, authors first read,
unique recap genres, and genres first read. First appearances are compared with
all earlier finished reads on this device, including earlier quarters in the same
year. Abandoned and unread entries do not establish a discovery. Missing authors
and uncategorised genres are excluded. Author names and custom genres are matched
without case or spacing differences; no author aliases are guessed. Counts reflect
the available imported history, rather than a claim about lifetime reading.

Libby cover URLs from imported JSON or CSV records take priority over Open Library
art, including for previously confirmed reads. The Open Library image is fetched
only if no usable imported cover is available. Images are cached when a recap is
opened online and reused offline. Confirmed image 404s trigger a lookup for another cover on the matched
work or edition. Missing URLs are remembered so they are not retried every visit;
temporary network errors do not discard covers. ISBNs without catalogue artwork
are not used to invent cover URLs. Books without available art use title
placeholders and appear in **Review missing book details**. Two palettes ship initially;
see [themes/README.md](themes/README.md) to add another.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Adding an importer or a card theme should be a
one-afternoon job.

## Licence

[MIT](LICENSE)

