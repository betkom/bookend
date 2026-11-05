import { describe, expect, it } from 'vitest';
import { buildCards, themes } from './cards';
import { buildRecap, type RecapEntry } from './data';
import { storyIndex, swipeStep } from './storyNavigation';

const read: RecapEntry = {
  id: 'r', workId: 'w', status: 'finished', formats: ['audio'], finishedAt: '2026-01-12',
  work: { id: 'w', title: 'A book', authors: [], genres: [] }, editions: [], sources: ['spotify'],
};
const sparse = () => buildRecap([read], { year: 2026 });

describe('adaptive recap stories', () => {
  it('keeps a sparse history useful without missing-data or zero metric cards', () => {
    const cards = buildCards(sparse(), themes[0], {}, true);
    expect(cards.map((card) => card.id)).toEqual(['formats', 'busiest', 'covers-1', 'total', 'summary']);
    expect(cards.at(-1)?.description).toBe('1 book finished');
    expect(cards.map((card) => card.description).join(' ')).not.toMatch(/0 books|0 hours|0 pages|unknown|unavailable|uncategorised|abandoned/i);
    expect(cards.find((card) => card.id === 'covers-1')?.svg).toContain('A book');
  });

  it('produces no story for an empty period, including abandoned-only histories', () => {
    const stats = buildRecap([{ ...read, status: 'abandoned' }], { year: 2026 });
    expect(stats.abandoned).toBe(1);
    expect(buildCards(stats, themes[0], {}, true)).toEqual([]);
  });

  it('hides zero discoveries without hiding known authors or genres', () => {
    const authored = { ...read, work: { ...read.work, authors: ['An Author'], genres: ['Fantasy'] } };
    const stats = buildRecap([{ ...authored, id: 'prior', finishedAt: '2025-01-01' }, authored], { year: 2026 });
    const cards = buildCards(stats, themes[0]);
    expect(stats.newAuthors).toEqual([]);
    expect(stats.newGenres).toEqual([]);
    expect(cards.find((card) => card.id === 'discoveries')?.description).toBe('1 unique authors. 1 genres read');
    expect(cards.find((card) => card.id === 'summary')?.description).not.toMatch(/new authors|new genres/);
  });

  it('rejects zero, negative and nonfinite facts individually', () => {
    const stats = { ...sparse(), pages: 0, minutes: 0, runtimeMinutes: 0,
      formats: { paper: 0, ebook: -1, audio: 1 }, sources: { paper: 0, libby: 0, audible: 0, spotify: 1 },
      genres: [['Uncategorised', 1], ['Fantasy', 0], [' ', 2]] as [string, number][],
      authors: [['An author', 0], ['Another', NaN]] as [string, number][],
      longest: { title: 'No pages', pages: Infinity }, fastest: { title: 'Same day', days: 0 }, busiest: ['2026-01', 0] as [string, number],
    };
    expect(buildCards(stats, themes[0]).map((card) => card.id)).toEqual(['formats', 'covers-1', 'total', 'summary']);
    for (const total of [0, -1, NaN, Infinity]) expect(buildCards({ ...stats, total }, themes[0])).toEqual([]);
  });

  it('preserves small positive listening values instead of rounding them to zero', () => {
    const cards = buildCards({ ...sparse(), minutes: 1 }, themes[0]);
    expect(cards.find((card) => card.id === 'time')?.description).toBe('<0.1 hours listened.');
    expect(cards.at(-1)?.description).toContain('<0.1 hours listened');
    expect(cards.find((card) => card.id === 'time')?.svg).toContain('&lt;0.1');
  });

  it('builds separate listening and page stories with a final shareable summary', () => {
    const stats = { ...sparse(), pages: 300, runtimeMinutes: 600, runtimeKnown: 1, uniqueAuthors: 3, uniqueGenres: 2,
      newAuthors: ['A', 'B'], newGenres: ['Fantasy'], abandoned: 2 };
    const cards = buildCards(stats, themes[0], {}, true);
    expect(cards.find((card) => card.id === 'time')?.description).toBe('10 audio hours · estimated.');
    expect(cards.find((card) => card.id === 'pages')?.description).toBe('300 pages read.');
    expect(cards.at(-2)?.id).toBe('total');
    expect(cards.at(-2)?.description).toContain('2 abandoned');
    expect(cards.at(-1)?.id).toBe('summary');
    expect(cards.at(-1)?.description.split('. ')).toHaveLength(5);
    expect(buildCards(stats, themes[0]).find((card) => card.id === 'total')?.description).not.toContain('abandoned');
  });
});

describe('story navigation', () => {
  it('clamps navigation and survives a shrinking or empty sequence', () => {
    expect(storyIndex(0, 4, -1)).toBe(0);
    expect(storyIndex(3, 4, 1)).toBe(3);
    expect(storyIndex(1, 4, 1)).toBe(2);
    expect(storyIndex(12, 3)).toBe(2);
    expect(storyIndex(12, 0)).toBe(0);
  });
  it('accepts deliberate horizontal swipes without intercepting taps or vertical scrolling', () => {
    expect(swipeStep(-80, 10)).toBe(1);
    expect(swipeStep(80, -10)).toBe(-1);
    expect(swipeStep(20, 0)).toBe(0);
    expect(swipeStep(-60, 90)).toBe(0);
    expect(swipeStep(45, 40)).toBe(0);
  });
});
