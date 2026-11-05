/**
 * Run a real export through an importer and print what came out.
 * Use it whenever you get a new export, to check the importer still understands it.
 *
 *   npm run try-import -- private-exports/libby/timeline.json --source libby
 *   npm run try-import -- private-exports/spotify/history.json --source spotify
 *   npm run try-import -- some-file.csv --source libby --events
 *
 * Options:
 *   --source <id>  Importer to use. Default: the only importer accepting the file's extension.
 *   --events       Print every event, not just a sample.
 *
 * Exits with code 1 if the file can't be imported.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { ImportError, importers, type Importer, type RawEvent } from '../importers/index';
import { libbyLoans, summariseLoans } from '../app/src/loans';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--source');
if (!file) fail('Usage: npm run try-import -- <file> [--source <id>] [--events]');

function pickImporter(path: string): Importer {
  const source = option('--source');
  if (source) {
    return importers.find((i) => i.source === source) ?? fail(`No importer called "${source}". Known: ${importers.map((i) => i.source).join(', ')}`);
  }
  const ext = extname(path).toLowerCase();
  const matches = importers.filter((i) => i.accept.includes(ext));
  if (matches.length === 1) return matches[0];
  if (!matches.length) fail(`No importer accepts ${ext} files.`);
  return fail(`Several importers accept ${ext} files (${matches.map((i) => i.source).join(', ')}). Pick one with --source.`);
}

const count = <T,>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
};

const row = (e: RawEvent) =>
  [e.timestamp.slice(0, 16).replace('T', ' '), e.type.padEnd(8), (e.format ?? '?').padEnd(5), e.rawTitle, e.rawAuthor ? `— ${e.rawAuthor}` : '']
    .join('  ')
    .trimEnd();

let text: string;
try {
  text = readFileSync(file, 'utf8');
} catch {
  fail(`Can't read ${file}`);
}

const importer = pickImporter(file);
let result;
try {
  result = importer.parse(text, basename(file));
} catch (e) {
  fail(e instanceof ImportError ? e.message : `Importer crashed: ${(e as Error).stack}`);
}

const { events, warnings } = result;
const titles = new Set(events.map((e) => `${e.rawTitle.toLowerCase()}|${e.rawAuthor.toLowerCase()}`));
const missing = (pick: (e: RawEvent) => unknown) => events.filter((e) => !pick(e)).length;

console.log(`\n${basename(file)} → ${importer.label} importer\n`);
console.log(`  Events      ${events.length}`);
if (events.length) {
  console.log(`  By type     ${count(events, (e) => e.type)}`);
  console.log(`  By format   ${count(events, (e) => e.format ?? 'unknown')}`);
  console.log(`  Date range  ${events[0].timestamp.slice(0, 10)} → ${events.at(-1)!.timestamp.slice(0, 10)}`);
  console.log(`  Titles      ${titles.size} distinct`);
  console.log(`  Missing     author ${missing((e) => e.rawAuthor)} · ISBN ${missing((e) => e.isbn)}`);
  const loans = libbyLoans(events);
  if (loans.length) {
    const s = summariseLoans(loans);
    console.log(`  Loans       ${loans.length}: ${s.finished} read · ${s['not-read']} not read · ${s['in-progress']} on loan · ${s.unknown} unknown`);
    const notRead = loans.filter((l) => l.status === 'not-read').map((l) => l.rawTitle);
    if (notRead.length) console.log(`  Not read    ${notRead.join(' · ')}`);
  }
}

if (warnings.length) {
  console.log('\n  Warnings');
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}

if (events.length) {
  const all = flag('--events');
  const shown = all ? events : events.slice(-8);
  console.log(`\n  ${all ? 'All events' : `Latest ${shown.length} events (--events for all)`}`);
  for (const e of shown) console.log(`  ${row(e)}`);
}
console.log();

