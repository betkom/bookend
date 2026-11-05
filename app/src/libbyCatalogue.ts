import { runtimeMinutes } from '@importers/metadata';

/** Public catalogue metadata only. Never sends loan dates, library cards or account credentials. */
const requests = new WeakMap<typeof fetch, Map<string, Promise<number | undefined>>>();
export const clearLibbyCatalogueCache = () => requests.delete(fetch);

export async function lookupLibbyRuntime(titleId: string, fetchFn: typeof fetch = fetch): Promise<number | undefined> {
  if (!/^\d+$/.test(titleId)) return undefined;
  let cache = requests.get(fetchFn);
  if (!cache) { cache = new Map(); requests.set(fetchFn, cache); }
  if (!cache.has(titleId)) cache.set(titleId, (async () => {
    const response = await fetchFn(`https://thunder.api.overdrive.com/v2/media/${titleId}`, {
      credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Libby catalogue returned ${response.status}`);
    const data = await response.json();
    if (String(data.id) !== titleId || data.type?.id !== 'audiobook' || !Array.isArray(data.formats)) return undefined;
    // Libby uses OverDrive Listen. The MP3 edition can have a different runtime.
    const listen = data.formats.find((format: { id?: string }) => format?.id === 'audiobook-overdrive');
    if (listen) return typeof listen.duration === 'string' ? runtimeMinutes(listen.duration) : undefined;
    // Only accept an alternate audio format when its explicit runtimes agree.
    const runtimes = new Set<number>(data.formats.filter((format: { id?: string }) => typeof format?.id === 'string' && format.id.startsWith('audiobook-'))
      .flatMap((format: { duration?: unknown }) => typeof format.duration === 'string' ? [runtimeMinutes(format.duration)].filter((value): value is number => value !== undefined) : []));
    return runtimes.size === 1 ? [...runtimes][0] : undefined;
  })());
  try { return await cache.get(titleId); }
  catch (error) { cache.delete(titleId); throw error; }
}
