# Recap themes

Cards are SVGs rendered locally to 1080 × 1920 PNGs. The initial themes are
`paper/theme.json` (Playful) and `midnight/theme.json` (Ink).

To add a palette, copy a theme folder and change `id`, `name`, `background`, `surface`, `ink`,
`accent`, `muted` and `line`. Use hex colours with enough text contrast. Import
it and add it to `themes` in `app/src/recap/cards.ts`. Layout templates live in that
file and share XML escaping, wrapping and cover-wall pagination.

Check every available card type with long titles, sparse metadata, a large cover
wall, and both full-year and quarterly periods. Cards are assembled dynamically:
empty and zero metrics are omitted, and the summary includes only positive facts.
Verify previews, the mobile full-screen viewer, and exported images. Run
`npm test` and `npm run build`.
