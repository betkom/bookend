import type { RecapCard } from './cards';
import { isCoverUrl } from './coverUrls';

export type CoverResult = { status: 'ready'; data: string } | { status: 'missing' | 'error' };

/** Fetch imported Libby covers or Open Library art; persist readable images for export. */
export async function loadCoverResult(url: string, fetchFn: typeof fetch = fetch): Promise<CoverResult> {
  if (!isCoverUrl(url)) return { status: 'error' };
  try {
    // Some private browsing/storage settings disable Cache Storage; rendering still works.
    const cache = 'caches' in globalThis ? await caches.open('bookend-recap-covers-v1').catch(() => undefined) : undefined;
    let response = await cache?.match(url).catch(() => undefined);
    if (!response) {
      const requestUrl = new URL(url);
      if (requestUrl.hostname === 'covers.openlibrary.org') requestUrl.searchParams.set('default', 'false');
      response = await fetchFn(requestUrl.href, { mode: 'cors', signal: AbortSignal.timeout(12000) });
      if (response.status === 404) return { status: 'missing' };
      if (!response.ok || response.type === 'opaque') return { status: 'error' };
      if (cache) await cache.put(url, response.clone()).catch(() => undefined);
    }
    const blob = await response.blob();
    if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) return { status: 'error' };
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
    });
    return { status: 'ready', data };
  } catch { return { status: 'error' }; }
}

/** Stop at the first usable image; an imported cover must not trigger an Open Library request. */
export async function loadFirstCover(urls: string[], fetchFn: typeof fetch = fetch): Promise<{ url?: string; data?: string; missing: string[] }> {
  const missing: string[] = [];
  for (const url of urls) {
    const result = await loadCoverResult(url, fetchFn);
    if (result.status === 'ready') return { url, data: result.data, missing };
    if (result.status === 'missing') missing.push(url);
  }
  return { missing };
}

export async function cardPng(card: RecapCard): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([card.svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render this card. Please try again.')); image.src = url;
    });
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot export images.');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = file.name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Files are prepared before the click, preserving the Web Share user gesture. */
export async function shareCard(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'My Bookend recap' }); return 'shared'; }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'; }
  }
  downloadFile(file); return 'downloaded';
}
