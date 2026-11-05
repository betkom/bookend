import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ImportError } from '../types';
import { spotifyImporter } from './index';
import { importerFor } from '../index';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../fixtures/spotify/${name}`, import.meta.url)), 'utf8');
const mixed = fixture('synthetic-extended-streaming.json');
const rows = JSON.parse(mixed);
const bookRow = rows[0];
const parseRows = (list: unknown[]) => spotifyImporter.parse(JSON.stringify(list), 'history.json');

describe('Spotify extended streaming history', () => {
  it('is registered for JSON imports', () => {
    expect(importerFor('spotify')).toBe(spotifyImporter);
    expect(spotifyImporter.accept).toEqual(['.json']);
  });

  it('emits one actual listening event per audiobook session and sorts by time', () => {
    const { events } = spotifyImporter.parse(mixed, 'history.json');
    expect(events).toHaveLength(4);
    expect(events.map((event) => event.value)).toEqual([1, 30, 5, 20]);
    expect(events.reduce((sum, event) => sum + event.value!, 0)).toBe(56);
    expect(events.every((event) => event.source === 'spotify' && event.type === 'listened' && event.format === 'audio')).toBe(true);
    expect(events.map((event) => event.timestamp)).toEqual([...events.map((event) => event.timestamp)].sort());
    expect(events.slice(0, 3).every((event) => event.sourceItemId === 'spotify:show:0000000000000000000001')).toBe(true);
    expect(events[3].rawTitle).toBe('Moby-Dick');
    expect(events[0].extra).toEqual({ chapterUri: 'spotify:episode:0000000000000000000001', chapterTitle: 'Chapter 1' });
  });

  it('keeps positive listening from skipped chapters and does not infer a finished book', () => {
    const { events } = spotifyImporter.parse(mixed, 'history.json');
    expect(events.find((event) => event.extra?.chapterTitle === 'Chapter 3')?.value).toBe(5);
    expect(events.some((event) => event.type === 'finished' || event.type === 'progress')).toBe(false);
    expect(events.every((event) => event.rawAuthor === '' && event.durationMinutes === undefined)).toBe(true);
  });

  it('does not retain account or device context from playback records', () => {
    const { events } = spotifyImporter.parse(mixed, 'history.json');
    const serialized = JSON.stringify(events);
    for (const field of ['ip_addr', 'conn_country', 'platform', 'offline_timestamp', 'incognito_mode', '192.0.2.10']) expect(serialized).not.toContain(field);
  });

  it('accepts the observed music/podcast-only shape but imports no books', () => {
    const { events, warnings } = spotifyImporter.parse(fixture('synthetic-non-audiobook-history.json'), 'video.json');
    expect(events).toEqual([]);
    expect(warnings.some((warning) => warning.includes('Skipped 2 music, podcast'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('No usable audiobook listening'))).toBe(true);
  });

  it('skips zero-time audiobook plays with a warning', () => {
    const { events, warnings } = parseRows([{ ...bookRow, ms_played: 0 }]);
    expect(events).toEqual([]);
    expect(warnings.some((warning) => warning.includes('zero listening time'))).toBe(true);
  });

  it('reports invalid rows without discarding valid audiobook listening', () => {
    const { events, warnings } = parseRows([bookRow, null, { unexpected: true },
      { ...bookRow, ms_played: -1 }, { ...bookRow, ms_played: '60000' },
      { ...bookRow, ms_played: null }, { ...bookRow, ts: 'not-a-date' },
      { ...bookRow, ts: '2026-02-30T00:00:00Z' }, { ...bookRow, ts: '2026-03-01T00:00:00' }]);
    expect(events).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes('Skipped 8 malformed'))).toBe(true);
  });

  it('never substitutes a chapter name for an absent book title', () => {
    const { events, warnings } = parseRows([{ ...bookRow, audiobook_title: null }]);
    expect(events).toEqual([]);
    expect(warnings.some((warning) => warning.includes('without a book title'))).toBe(true);
  });

  it('imports audiobook records with null chapter titles, preserving their episode URI', () => {
    const { events } = spotifyImporter.parse(mixed, 'audio.json');
    const event = events.find((event) => event.rawTitle === 'Moby-Dick')!;
    expect(event).toMatchObject({ value: 20, sourceItemId: 'spotify:show:0000000000000000000002' });
    expect(event.extra).toEqual({ chapterUri: 'spotify:episode:0000000000000000000004' });
  });

  it('retains sub-minute listening precision from millisecond counts', () => {
    expect(parseRows([{ ...bookRow, ms_played: 12345 }]).events[0].value).toBe(12345 / 60000);
  });

  it('retains a titled audiobook session with no book URI and warns about matching', () => {
    const { events, warnings } = parseRows([{ ...bookRow, audiobook_uri: null }]);
    expect(events[0]).toMatchObject({ rawTitle: 'Pride and Prejudice', value: 30 });
    expect(events[0].sourceItemId).toBeUndefined();
    expect(warnings.some((warning) => warning.includes('no book URI'))).toBe(true);
  });

  it('normalizes offsets and handles a JSON BOM', () => {
    const result = spotifyImporter.parse('\uFEFF' + JSON.stringify([{ ...bookRow, ts: '2026-03-01T01:00:00+01:00' }]), 'history.json');
    expect(result.events[0].timestamp).toBe('2026-03-01T00:00:00.000Z');
  });

  it.each(['', 'bad JSON', '{}', '{"timeline":[]}', '[{"endTime":"2026-03-01 10:00","trackName":"Song","msPlayed":60000}]', '[{"ts":"2026-03-01T00:00:00Z","ms_played":60000}]'])('rejects unsupported files with an ImportError: %s', (text) => {
    expect(() => spotifyImporter.parse(text, 'input.json')).toThrow(ImportError);
  });

  it('accepts an empty export with a clear warning', () => {
    expect(spotifyImporter.parse('[]', 'empty.json')).toMatchObject({ events: [], warnings: [expect.stringContaining('No usable audiobook listening')] });
  });
});
