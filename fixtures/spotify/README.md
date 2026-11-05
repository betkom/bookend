# Spotify extended streaming history fixtures

These are hand-authored synthetic records. No real export rows or personal values
were copied into the fixtures. Titles are public-domain books or invented media,
all Spotify IDs are dummy values, and the IP address is from the documentation
range `192.0.2.0/24`.

## Verified source structure

Inspected locally in November 2026: `Streaming_History_Audio_2025.json` and video
history files from Spotify's **Extended streaming history** download. The files are top-level JSON
arrays with these 23 keys on each record:

- Playback: `ts` (ISO timestamp with timezone), `ms_played` (integer milliseconds).
- Context: `platform`, `conn_country`, `ip_addr`.
- Music: `master_metadata_track_name`, `master_metadata_album_artist_name`,
  `master_metadata_album_album_name`, `spotify_track_uri`.
- Podcasts: `episode_name`, `episode_show_name`, `spotify_episode_uri`.
- Audiobooks: `audiobook_title`, `audiobook_uri`, `audiobook_chapter_uri`,
  `audiobook_chapter_title`.
- Playback flags: `reason_start`, `reason_end`, `shuffle`, `skipped`, `offline`,
  `offline_timestamp`, `incognito_mode`.

The updated audio sample verifies the audiobook path: non-empty `audiobook_title`
values, `spotify:show:` book URIs, and `spotify:episode:` chapter URIs. A chapter
title can be null while the book title and chapter URI are present. URI namespaces
are shared with podcasts, so media classification uses the audiobook fields.
Positive `skipped` sessions still carry actual listening time. No audiobook author, ISBN, total runtime, or book-finished
flag appears in the observed schema; the importer does not invent them.

## Fixtures

- `synthetic-extended-streaming.json`: same keys and root shape as the samples,
  with four positive audiobook listening sessions across two books, a zero-time
  audiobook play, one music play, and one podcast play. Deliberately unsorted.
  The positive sessions total **56 minutes**. One skipped chapter still has five
  actual minutes played; another session has an offline flag and a null chapter
  title. Book and chapter URI namespaces match the verified audio export.
- `synthetic-non-audiobook-history.json`: music/podcast rows with all audiobook
  fields null, matching the content pattern of the real video samples. Produces zero
  reading events and an explanatory warning.

## Import behavior

Each positive audiobook session becomes a `listened` event, using the book title
and book URI, with chapter title/URI as evidence. Milliseconds are converted to
minutes. Music/podcasts and zero-time sessions are skipped. Invalid audiobook rows
produce warnings without preventing good rows from importing. Completing or
skipping a chapter never confirms a finished book. Playback IPs, country, device,
and other account context are not saved.

The importer adds raw listening events to the log. Recap groups sessions by book,
compares listening time with runtime, and offers a review step. Overlapping exports
count a session once; the duplicate-file warning also catches identical files.

Check private samples without committing them:

```sh
npm run try-import -- private-exports/spotify/Streaming_History_Audio_2025.json --source spotify
```
