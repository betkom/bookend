import { periodLabel, type RecapStats } from './data';
import paper from '../../../themes/paper/theme.json';
import midnight from '../../../themes/midnight/theme.json';

export const themes = [paper, midnight];
export type Theme = typeof paper;
export interface RecapCard { id: string; title: string; svg: string }
export const escapeXml = (value: string | number) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const number = (n: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(n);

export function buildCards(stats: RecapStats, theme: Theme, covers: Record<string, string> = {}, showAbandoned = false, fontCss = ''): RecapCard[] {
  const cards: RecapCard[] = [];
  const text = (value: string | number, x: number, y: number, size = 36, color = theme.ink, display = false) =>
    `<text x="${x}" y="${y}" fill="${color}" font-family="Inter Variable, Arial, sans-serif" font-weight="${display ? 900 : 400}" font-style="${display ? 'italic' : 'normal'}" font-size="${size}">${escapeXml(value)}</text>`;
  const rule = (y: number) => `<path d="M88 ${y}H992" stroke="${theme.line}" stroke-width="2"/>`;
  const lines = (value: string, y: number, size = 44, max = 33, x = 88, count = 3) => {
    const words = value.split(/\s+/); const rows: string[] = []; let row = '';
    for (const word of words) {
      const clipped = word.length > max ? `${word.slice(0, max - 1)}…` : word;
      if (row && (row + ' ' + clipped).length > max) { rows.push(row); row = clipped; } else row += (row ? ' ' : '') + clipped;
    }
    if (row) rows.push(row);
    return rows.slice(0, count).map((r, i) => text(i === count - 1 && rows.length > count ? r.slice(0, -1) + '…' : r, x, y + i * size * 1.25, size)).join('');
  };
  const add = (id: string, title: string, body: string) => {
    const index = cards.length + 1;
    cards.push({ id, title, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><style>${fontCss}</style><rect width="1080" height="1920" fill="${theme.background}"/><rect x="32" y="32" width="1016" height="1856" rx="44" fill="${theme.surface}"/>${text('Bookend', 88, 140, 38, theme.accent, true)}${text(periodLabel(stats.period).toUpperCase(), 88, 214, 26, theme.muted)}${rule(260)}${text(title, 88, 380, 76, theme.ink, true)}${body}${rule(1740)}${text(String(index).padStart(2, '0'), 940, 1810, 28, theme.accent)}</svg>` });
  };
  add('total', 'Books finished', text(stats.total, 80, 850, 320, theme.accent, true) + text('books finished', 88, 960, 64)
    + (showAbandoned ? text(`${stats.abandoned} abandoned`, 88, 1500, 36, theme.muted) : ''));
  let formatBody = text('Books by format', 88, 500, 34, theme.muted);
  const labels = { paper: 'Paper', ebook: 'Ebook', audio: 'Audio' };
  Object.entries(stats.formats).forEach(([format, count], i) => {
    const y = 650 + i * 200;
    formatBody += text(labels[format as keyof typeof labels], 88, y, 44) + text(`${Math.round(count / Math.max(stats.total, 1) * 100)}%`, 800, y, 52, theme.accent)
      + `<rect x="88" y="${y + 40}" width="904" height="14" fill="${theme.line}"/><rect x="88" y="${y + 40}" width="${904 * count / Math.max(stats.total, 1)}" height="14" fill="${theme.accent}"/>`;
  });
  formatBody += text('Finished reads by source', 88, 1260, 32, theme.muted);
  formatBody += Object.entries(stats.sources).filter(([, n]) => n > 0).map(([source, n], i) => text(`${source === 'paper' ? 'Paper' : source[0].toUpperCase() + source.slice(1)}  ·  ${n}  ·  ${Math.round(n / Math.max(stats.total, 1) * 100)}%`, 88, 1340 + i * 64, 38)).join('');
  add('formats', 'Reading formats', formatBody);
  const audioKnown = stats.minutesKnown + stats.runtimeKnown;
  add('time', 'Hours & pages', text(stats.formats.audio > 0 && audioKnown === 0 ? 'Unknown' : number((stats.minutes + stats.runtimeMinutes) / 60), 88, 720, stats.formats.audio > 0 && audioKnown === 0 ? 130 : 180, theme.accent, true) + text(stats.runtimeKnown ? 'audio hours · estimated' : audioKnown === 0 && stats.formats.audio > 0 ? 'audio hours unavailable' : 'hours listened', 88, 820, 48)
    + text(number(stats.pages), 88, 1150, 180, theme.accent, true) + text(stats.estimatedPages ? 'pages read · estimated' : 'pages read', 88, 1250, 48));
  add('genres', 'Top genres', stats.genres.slice(0, 3).map(([genre, count], i) => text(`0${i + 1}`, 88, 620 + i * 330, 32, theme.accent)
    + lines(genre, 710 + i * 330, 54, 26, 88, 2) + text(`${Math.round(count / Math.max(stats.total, 1) * 100)}% of finished reads`, 88, 860 + i * 330, 32, theme.muted)).join(''));
  add('authors', 'Top authors', stats.authors.length ? stats.authors.slice(0, 3).map(([name, count], i) =>
    text(`0${i + 1}`, 88, 570 + i * 340, 32, theme.accent) + lines(name, 660 + i * 340, 52, 28, 88, 2)
    + text(`${number(count)} ${count === 1 ? 'book' : 'books'}`, 88, 820 + i * 340, 42, theme.accent)).join('')
    : lines('No authors recorded yet.', 700, 60, 24));
  add('discoveries', 'Discoveries', [
    { value: stats.uniqueAuthors, label: 'unique authors', x: 88, y: 740 },
    { value: stats.newAuthors.length, label: 'new authors', x: 570, y: 740 },
    { value: stats.uniqueGenres, label: 'genres read', x: 88, y: 1250 },
    { value: stats.newGenres.length, label: 'new genres', x: 570, y: 1250 },
  ].map(({ value, label, x, y }) => text(number(value), x, y, 160, theme.accent, true) + text(label, x, y + 100, 42)).join(''));
  add('library', 'Library books', text(stats.sources.libby, 88, 850, 300, theme.accent, true) + lines('finished reads borrowed through Libby', 1010, 62, 24));
  let highlights = '';
  highlights += text('LONGEST BOOK · PAGES', 88, 560, 28, theme.accent) + lines(stats.longest?.title ?? 'No page counts yet', 650, 48, 32, 88, 2)
    + text(stats.longest ? `${number(stats.longest.pages)} pages` : 'Page metadata needed', 88, 790, 32, theme.muted);
  highlights += text('FASTEST FINISH', 88, 940, 28, theme.accent) + lines(stats.fastest?.title ?? 'No start dates yet', 1030, 48, 32, 88, 2)
    + text(stats.fastest ? `${number(stats.fastest.days)} days from start to finish` : 'Start and finish dates needed', 88, 1170, 32, theme.muted);
  const busiest = stats.busiest ? new Date(stats.busiest[0] + '-01T00:00:00Z').toLocaleDateString('en', { month: 'long', timeZone: 'UTC' }) : 'Not recorded';
  highlights += text('BUSIEST MONTH', 88, 1320, 28, theme.accent) + text(busiest, 88, 1430, 80, theme.ink, true)
    + text(`${stats.busiest?.[1] ?? 0} books finished`, 88, 1520, 38, theme.muted);
  add('highlights', 'Highlights', highlights);
  // Paginate so every read, including re-reads, gets a place on the wall.
  for (let page = 0; page < Math.ceil(stats.finished.length / 12); page++) {
    const entries = stats.finished.slice(page * 12, (page + 1) * 12);
    let wall = '';
    entries.forEach((entry, i) => {
      const x = 88 + (i % 3) * 310; const y = 470 + Math.floor(i / 3) * 300;
      const cover = (entry.coverUrls ?? (entry.work.coverUrl ? [entry.work.coverUrl] : [])).map((url) => covers[url]).find(Boolean);
      wall += `<rect x="${x}" y="${y}" width="264" height="230" rx="16" fill="${theme.line}"/>`;
      if (cover && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(cover)) wall += `<image x="${x}" y="${y}" width="264" height="230" preserveAspectRatio="xMidYMid meet" href="${cover}"/>`;
      else wall += text('BOOKEND', x + 32, y + 125, 24, theme.muted);
      wall += lines(entry.work.title, y + 263, 22, 23, x, 1);
    });
    add(`covers-${page + 1}`, 'Books I read', wall);
  }
  return cards;
}
