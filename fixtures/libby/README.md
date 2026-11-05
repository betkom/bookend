# Libby fixtures

Synthetic samples of the Libby timeline export, used by `importers/libby/libby.test.ts`.
They are made up but mirror the structure of real exports exactly.

| File | What it is |
| --- | --- |
| `synthetic-timeline.csv` | Real CSV column layout; borrows, returns, a hold and a blank ISBN. |
| `synthetic-timeline.json` | Real JSON structure; borrows, a hold and a magazine. |

Real exports are **not** committed. Keep them in the git-ignored `private-exports/libby/` and
check them with `npm run try-import -- private-exports/libby/<file>`.

## What real exports look like (verified 2026-11)

**JSON** ("Data (JSON)") — preferred

- Top level: `{ "version": 1, "timeline": [...] }`, newest first.
- `title` is an object: `{ text, url, titleId }`.
- `timestamp` is epoch milliseconds.
- Format lives in `cover.format` (`"audiobook"`, `"ebook"`), not at the top level.
- `library` is an object: `{ text, url, key }`.

**CSV** ("Data (CSV)")

- Columns: `cover,title,author,publisher,isbn,timestamp,activity,details,library`.
- **No format column** — ebook vs audiobook is unknown. No title id.
- `timestamp` looks like `September 28, 2026 22:40` with no zone, but it is **UTC**
  (checked row by row against the JSON export of the same timeline).
- Multi-author fields are quoted: `"Clive Cussler, Graham Brown"`. Missing ISBNs are `""`.

**Both**

- `activity` labels seen in a full export, and what `details` holds for each:

  | activity | details | Bookend event |
  | --- | --- | --- |
  | `Borrowed` | `" 21 days "` (loan length) | `borrowed`, `extra.loanDays` |
  | `Renewed` | `" 14 days "` (new loan length) | `renewed`, `extra.loanDays` |
  | `Returned` | `" 6 days  early"`, `" 1 day  early"`, `"on due date"` | `returned`, `extra.daysEarly` |
  | `Placed on hold` | `""` | ignored |
  | `Hold expired` | `""` | ignored |

  Any other label is skipped with a warning that the format may have changed.
- Spacing in `details` is irregular; normalise whitespace before parsing.
- Each loan has exactly one `Borrowed` and one `Returned` with the same `titleId`. Some loans
  are returned within minutes of borrowing (sampled and not read).
- ISBN can be blank, and may be blank in one export format but present in the other.
- The timeline can be filtered in the app before exporting; a "returns only" export has no borrows.
