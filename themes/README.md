# Recap themes

Cards are SVGs rendered locally to 1080 × 1920 PNGs. The initial themes are
`paper/theme.json` (Playful) and `midnight/theme.json` (Ink).

To add a palette, copy a theme folder and change `id`, `name`, `background`, `surface`, `ink`,
`accent`, `muted` and `line`. Use hex colours with enough text contrast. Import
it and add it to `themes` in `app/src/recap/cards.ts`. Layout templates live in that
file and share XML escaping, wrapping and cover-wall pagination.

Check all nine card types with long titles, missing metadata, a large cover wall,
and both full-year and quarterly periods. Run `npm test` and `npm run build`.
