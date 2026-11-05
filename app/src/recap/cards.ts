import { periodLabel, type RecapStats } from './data';
import paper from '../../../themes/paper/theme.json';
import midnight from '../../../themes/midnight/theme.json';

export const themes = [paper, midnight];
export type Theme = typeof paper;
export interface RecapCard { id: string; title: string; description: string; svg: string }
export const escapeXml = (value: string | number) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const positive = (value: number) => Number.isFinite(value) && value > 0;
const number = (value: number) => value > 0 && value < 0.1 ? '<0.1' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
const bookCount = (count: number) => `${number(count)} ${count === 1 ? 'book' : 'books'}`;

/** Only usable, positive facts enter the story or its exported images. */
export function buildCards(stats: RecapStats, theme: Theme, covers: Record<string, string> = {}, showAbandoned = false, fontCss = ''): RecapCard[] {
  if (!positive(stats.total)) return [];
  const cards: RecapCard[] = [];
  const text = (value: string | number, x: number, y: number, size = 36, color = theme.ink, display = false) =>
    `<text x="${x}" y="${y}" fill="${color}" font-family="Inter Variable, Arial, sans-serif" font-weight="${display ? 900 : 400}" font-style="${display ? 'italic' : 'normal'}" font-size="${size}">${escapeXml(value)}</text>`;
  const lines = (value: string, y: number, size = 64, max = 25, x = 88, count = 3, display = false) => {
    const words = value.split(/\s+/); const rows: string[] = []; let row = '';
    for (const word of words) {
      const clipped = word.length > max ? `${word.slice(0, max - 1)}…` : word;
      if (row && (row + ' ' + clipped).length > max) { rows.push(row); row = clipped; } else row += (row ? ' ' : '') + clipped;
    }
    if (row) rows.push(row);
    return rows.slice(0, count).map((r, i) => text(i === count - 1 && rows.length > count ? r.slice(0, -1) + '…' : r, x, y + i * size * 1.18, size, theme.ink, display)).join('');
  };
  const add = (id: string, title: string, headline: string, body: string, description: string) => {
    cards.push({ id, title, description, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><style>${fontCss}</style><rect width="1080" height="1920" fill="${theme.background}"/><rect x="32" y="32" width="1016" height="1856" rx="44" fill="${theme.surface}"/>${text(periodLabel(stats.period), 88, 145, 34, theme.muted)}${text('Bookend', 788, 145, 38, theme.accent, true)}${lines(headline, 340, 88, 20, 88, 3, true)}${body}</svg>` });
  };
  const hero = (value: string | number, label: string, y = 1000) => text(value, 76, y, String(value).length > 5 ? 180 : 280, theme.accent, true)
    + lines(label, y + 120, 46, 36, 88, 2);
  const smallMetrics = (metrics: { value: number; label: string }[], y: number) => metrics.filter((metric) => positive(metric.value))
    .map((metric, i) => text(number(metric.value), 88 + i % 2 * 480, y + Math.floor(i / 2) * 250, 100, theme.accent, true)
      + lines(metric.label, y + 75 + Math.floor(i / 2) * 250, 32, 22, 88 + i % 2 * 480, 2)).join('');

  const formatLabels = { paper: 'Paper', ebook: 'Ebook', audio: 'Audiobook' };
  const formats = Object.entries(stats.formats).filter(([, count]) => positive(count));
  if (formats.length) add('formats', 'Reading formats', formats.length === 1 ? 'Your reading format.' : 'Your reading formats.', formats.map(([format, count], i) => {
    const y = 760 + i * 310;
    return text(bookCount(count), 88, y, 110, theme.accent, true) + text(formatLabels[format as keyof typeof formatLabels], 88, y + 82, 44)
      + `<path d="M88 ${y + 120}h${Math.round(904 * count / stats.total)}" stroke="${theme.ink}" stroke-width="8" stroke-linecap="round"/>`;
  }).join(''), formats.map(([format, count]) => `${bookCount(count)} in ${formatLabels[format as keyof typeof formatLabels]}`).join('. '));

  const audioMinutes = stats.minutes + stats.runtimeMinutes;
  if (positive(audioMinutes)) {
    const hours = audioMinutes / 60;
    const label = stats.runtimeKnown ? 'audio hours · estimated' : 'hours listened';
    add('time', 'Listening time', 'Your listening time.', hero(number(hours), label), `${number(hours)} ${label}.`);
  }
  if (positive(stats.pages)) {
    const label = stats.estimatedPages ? 'pages read · estimated' : 'pages read';
    add('pages', 'Pages read', 'You read.', hero(number(stats.pages), label), `${number(stats.pages)} ${label}.`);
  }

  const genres = stats.genres.filter(([name, count]) => name.trim() && name.toLowerCase() !== 'uncategorised' && positive(count)).slice(0, 3);
  if (genres.length) add('genres', 'Top genres', 'Your top genres.', genres.map(([name, count], i) => {
    const y = 740 + i * 310;
    return lines(name, y, i === 0 ? 74 : 52, i === 0 ? 20 : 28, 88, 2, i === 0) + text(bookCount(count), 88, y + 180, 38, theme.accent);
  }).join(''), genres.map(([name, count]) => `${name}: ${bookCount(count)}`).join('. '));
  const authors = stats.authors.filter(([name, count]) => name.trim() && positive(count)).slice(0, 3);
  if (authors.length) add('authors', 'Top authors', 'Your top authors.', authors.map(([name, count], i) => {
    const y = 740 + i * 310;
    return lines(name, y, i === 0 ? 74 : 52, i === 0 ? 20 : 28, 88, 2, i === 0) + text(bookCount(count), 88, y + 180, 38, theme.accent);
  }).join(''), authors.map(([name, count]) => `${name}: ${bookCount(count)}`).join('. '));

  const discoveries = [
    { value: stats.newAuthors.length, label: 'new authors' }, { value: stats.newGenres.length, label: 'new genres' },
    { value: stats.uniqueAuthors, label: 'unique authors' }, { value: stats.uniqueGenres, label: 'genres read' },
  ].filter((metric) => positive(metric.value));
  if (discoveries.length) {
    const [lead, ...rest] = discoveries;
    add('discoveries', 'Discoveries', lead.label.startsWith('new ') ? 'New discoveries.' : 'Authors and genres.', hero(number(lead.value), lead.label, 920) + smallMetrics(rest, 1320), discoveries.map((metric) => `${number(metric.value)} ${metric.label}`).join('. '));
  }
  if (positive(stats.sources.libby)) add('library', 'Library books', 'From your library.', hero(stats.sources.libby, 'books finished through Libby'), `${bookCount(stats.sources.libby)} finished through Libby.`);

  if (stats.longest && positive(stats.longest.pages)) add('longest', 'Longest book', 'Your longest book.', hero(number(stats.longest.pages), 'pages', 900)
    + lines(stats.longest.title, 1350, 62, 28, 88, 3), `${stats.longest.title}: ${number(stats.longest.pages)} pages.`);
  if (stats.fastest && positive(stats.fastest.days)) {
    const days = stats.fastest.days;
    const value = days >= 1 ? number(days) : days * 24 >= 1 ? number(days * 24) : days * 1440 >= 1 ? number(days * 1440) : '<1';
    const unit = days >= 1 ? 'days' : days * 24 >= 1 ? 'hours' : 'minutes';
    add('fastest', 'Fastest finish', 'Your fastest finish.', hero(value, unit, 900) + lines(stats.fastest.title, 1350, 62, 28, 88, 3), `${stats.fastest.title}: ${value} ${unit}.`);
  }
  if (stats.busiest && positive(stats.busiest[1])) {
    const month = new Date(stats.busiest[0] + '-01T00:00:00Z').toLocaleDateString('en', { month: 'long', timeZone: 'UTC' });
    add('busiest', 'Busiest month', 'Your busiest month.', lines(month, 920, 130, 12, 88, 2, true)
      + text(bookCount(stats.busiest[1]), 88, 1260, 110, theme.accent, true), `${month}: ${bookCount(stats.busiest[1])} finished.`);
  }

  // Include every read, even without artwork, without labelling missing metadata on the card.
  for (let page = 0; page < Math.ceil(stats.finished.length / 12); page++) {
    const entries = stats.finished.slice(page * 12, (page + 1) * 12);
    let wall = '';
    entries.forEach((entry, i) => {
      const x = 88 + i % 3 * 310; const y = 660 + Math.floor(i / 3) * 270;
      const cover = (entry.coverUrls ?? (entry.work.coverUrl ? [entry.work.coverUrl] : [])).map((url) => covers[url]).find(Boolean);
      wall += `<rect x="${x}" y="${y}" width="264" height="210" rx="16" fill="${theme.background}"/>`;
      if (cover && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(cover)) wall += `<image x="${x}" y="${y}" width="264" height="210" preserveAspectRatio="xMidYMid meet" href="${cover}"/>`;
      else wall += lines(entry.work.title, y + 65, 24, 16, x + 18, 4);
      wall += lines(entry.work.title, y + 245, 22, 23, x, 1);
    });
    add(`covers-${page + 1}`, 'Books I read', 'The books you finished.', wall, entries.map((entry) => entry.work.title).join('. '));
  }
  add('total', 'Books finished', 'You finished.', hero(stats.total, stats.total === 1 ? 'book' : 'books')
    + (showAbandoned && positive(stats.abandoned) ? text(`${stats.abandoned} abandoned`, 88, 1500, 36, theme.muted) : ''), `${bookCount(stats.total)} finished${showAbandoned && positive(stats.abandoned) ? `. ${stats.abandoned} abandoned` : ''}.`);

  const summary = [
    { value: audioMinutes / 60, label: stats.runtimeKnown ? 'audio hours · estimated' : 'hours listened' },
    { value: stats.pages, label: stats.estimatedPages ? 'pages read · estimated' : 'pages read' },
    { value: stats.uniqueAuthors, label: 'unique authors' }, { value: stats.newAuthors.length, label: 'new authors' },
    { value: stats.newGenres.length, label: 'new genres' }, { value: stats.uniqueGenres, label: 'genres read' },
  ].filter((metric) => positive(metric.value)).slice(0, 4);
  add('summary', 'Recap summary', `${periodLabel(stats.period)} recap.`, hero(stats.total, stats.total === 1 ? 'book finished' : 'books finished', 850)
    + smallMetrics(summary, 1280), [`${bookCount(stats.total)} finished`, ...summary.map((metric) => `${number(metric.value)} ${metric.label}`)].join('. '));
  return cards;
}
