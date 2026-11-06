# Contributing to Bookend

Thanks for helping. The two easiest ways in are **adding an importer** and
**adding a recap theme**. Look for issues labelled `good first issue`.

## Ground rules

- Reading data stays on the device. Book metadata comes from Open Library and
  the public Libby/OverDrive catalogue; imported cover URLs take priority.
- Importers parse files the user downloaded. No scraping, no stored credentials.
- Every importer ships with a synthetic fixture and a test.
- Never commit a real export, even anonymised. Use the git-ignored `private-exports/` folder for your private exports.

## Add an importer

1. **Get a real export.** Download your own data from the service and put it in
   `private-exports/<source>/` (git-ignored). Real exports never go in the repo.
2. **Make a synthetic fixture.** Write a small made-up file in `fixtures/<source>/` that
   copies the real file's exact structure (headers, nesting, date format, odd spacing) but
   uses invented or public-domain books. Document the format in `fixtures/<source>/README.md`.
3. **Write the importer** in `importers/<source>/index.ts`, exporting an object that
   implements `Importer` from [`importers/types.ts`](importers/types.ts):
   - `parse(text, fileName)` returns `{ events, warnings }`.
   - Emit one `RawEvent` per fact: `borrowed`, `returned`, `started`, `listened`,
     `progress` or `finished`, with the raw title/author as they appear in the file.
   - Preserve exported `genres` and full audiobook `durationMinutes` when available.
     Runtime is metadata, not measured listening: emit `listened` events only for
     actual listening minutes. Recaps use runtime as an approximate fallback.
   - Do **not** match books, call the network or touch storage. Matching happens later.
   - Throw `ImportError` with a helpful message when the file is unusable.
   - Prefer warnings over throwing when only some rows are bad.
4. **Register it** in [`importers/index.ts`](importers/index.ts).
5. **Test it** in `importers/<source>/<source>.test.ts` against your synthetic fixtures.
   See [`importers/libby/libby.test.ts`](importers/libby/libby.test.ts) for the pattern.
   Then check it against your real export, without committing it:

   ```sh
   npm run try-import -- private-exports/<source>/<file> --source <source>
   ```

   This prints event counts by type and format, the date range, fields that are missing,
   any warnings and a sample of events. Run it again whenever you get a fresh export to
   catch format changes.
6. Run `npm test` and `npm run typecheck`, then open a pull request.

## Add a theme

Copy a palette under `themes/<name>/`, register it in `app/src/recap/cards.ts`,
and verify all cards. See [themes/README.md](themes/README.md) for the fields,
layout templates, and validation checklist.

## Development

```sh
npm install
npm run dev
npm test
```

CI runs type checks, tests and a build on every pull request.

