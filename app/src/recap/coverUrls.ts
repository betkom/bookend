/** Only book-cover providers used by Open Library and Libby exports. */
export function isCoverUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && (url.hostname === 'covers.openlibrary.org' || /^img\d+\.od-cdn\.com$/.test(url.hostname)
        || url.hostname === 'ic.od-cdn.com' || url.hostname === 'images.contentreserve.com');
  } catch { return false; }
}

export const coverAddress = (url: string) => url.split('?')[0];

export const missingCover = (url: string, missing?: string[]) => missing?.some((saved) => coverAddress(saved) === coverAddress(url)) ?? false;
