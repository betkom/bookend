import type { BookendDB, Edition } from '../db';
import { lookupLibbyRuntime } from '../libbyCatalogue';

const valid = (value?: number) => value !== undefined && Number.isFinite(value) && value > 0;

/** Resolve old reads through their evidence so existing imports need no migration or re-import. */
export async function enrichLibbyRuntime(db: BookendDB, edition: Edition, options: {
  fetchFn?: typeof fetch; force?: boolean; cancelled?: () => boolean;
}): Promise<boolean> {
  if (edition.format !== 'audio' || edition.durationSource === 'manual'
    || (!options.force && edition.durationSource === 'libby-catalogue' && valid(edition.durationMinutes))) return false;
  if (!options.force && edition.libbyRuntimeCheckedAt && Date.now() - Date.parse(edition.libbyRuntimeCheckedAt) < 7 * 86400000) return false;
  const ids = await db.transaction('r', [db.reads, db.events], async () => {
    const reads = await db.reads.filter((read) => !!read.editionIds?.includes(edition.id)).toArray();
    const evidence = new Set(reads.flatMap((read) => read.eventIds ?? []));
    const events = await db.events.filter((event) => event.source === 'libby' && (event.editionId === edition.id || evidence.has(event.id))).toArray();
    return [...new Set([edition.libbyTitleId, ...events.map((event) => event.sourceItemId)].filter((id): id is string => !!id && /^\d+$/.test(id)))];
  });
  if (ids.length !== 1 || options.cancelled?.()) return false;
  const minutes = await lookupLibbyRuntime(ids[0], options.fetchFn);
  if (options.cancelled?.()) return false;
  let updated = false;
  await db.transaction('rw', [db.editions, db.events, db.reads], async () => {
    const current = await db.editions.get(edition.id);
    if (!current || current.durationSource === 'manual') return;
    // An import may have been undone while the catalogue request was in flight.
    const linkedReads = await db.reads.filter((read) => !!read.editionIds?.includes(edition.id)).toArray();
    const evidence = new Set(linkedReads.flatMap((read) => read.eventIds ?? []));
    const exists = await db.events.filter((event) => event.source === 'libby' && event.sourceItemId === ids[0]
      && (event.editionId === edition.id || evidence.has(event.id))).count();
    if (!exists) return;
    const patch: Partial<Edition> = { libbyTitleId: ids[0], libbyRuntimeCheckedAt: new Date().toISOString() };
    // Do not replace an unlabelled manual runtime from an older backup.
    if (minutes !== undefined && (!valid(current.durationMinutes) || current.durationSource === 'open-library-edition'
      || current.durationSource === 'open-library-work' || current.durationSource === 'libby-catalogue')) {
      patch.durationMinutes = minutes; patch.durationSource = 'libby-catalogue'; updated = true;
    }
    await db.editions.update(edition.id, patch);
  });
  return updated;
}
