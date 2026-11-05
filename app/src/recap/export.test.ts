import { afterEach, expect, it, vi } from 'vitest';
import { loadCoverResult, loadFirstCover } from './export';

afterEach(() => vi.unstubAllGlobals());
const url = 'https://covers.openlibrary.org/b/isbn/9780739365885-M.jpg';

it('identifies the reported ISBN 404 as missing instead of caching it or treating it as a network failure', async () => {
  const put = vi.fn();
  vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put }) });
  const request = vi.fn(async () => new Response('', { status: 404 }));
  expect(await loadCoverResult(url, request as typeof fetch)).toEqual({ status: 'missing' });
  expect(request).toHaveBeenCalledWith(`${url}?default=false`, expect.objectContaining({ mode: 'cors' }));
  expect(put).not.toHaveBeenCalled();
});

it('does not declare covers missing for network errors or server failures', async () => {
  vi.stubGlobal('caches', undefined);
  // An unavailable Cache Storage API must not prevent the fetch either.
  vi.stubGlobal('caches', { open: async () => { throw new Error('Storage unavailable'); } });
  expect(await loadCoverResult(url, (async () => { throw new Error('Offline'); }) as typeof fetch)).toEqual({ status: 'error' });
  expect(await loadCoverResult(url, (async () => new Response('', { status: 503 })) as typeof fetch)).toEqual({ status: 'error' });
});

it('converts valid covers even when writing the offline cache fails', async () => {
  vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put: async () => { throw new Error('Quota'); } }) });
  vi.stubGlobal('FileReader', class {
    result = 'data:image/jpeg;base64,YQ==';
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
  expect(await loadCoverResult('https://covers.openlibrary.org/b/id/42-M.jpg', (async () => new Response('a', { headers: { 'Content-Type': 'image/jpeg' } })) as typeof fetch)).toEqual({ status: 'ready', data: 'data:image/jpeg;base64,YQ==' });
});

function mockImageConversion() {
  vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put: async () => undefined }) });
  vi.stubGlobal('FileReader', class {
    result = 'data:image/jpeg;base64,YQ==';
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  });
}

it('uses the Libby cover without requesting Open Library when it works', async () => {
  mockImageConversion();
  const libby = 'https://img1.od-cdn.com/ImageType-100/example.JPG';
  const openLibrary = 'https://covers.openlibrary.org/b/id/42-M.jpg';
  const request = vi.fn(async () => new Response('a', { headers: { 'Content-Type': 'image/jpeg' } }));
  expect(await loadFirstCover([libby, openLibrary], request as typeof fetch)).toMatchObject({ url: libby, data: 'data:image/jpeg;base64,YQ==', missing: [] });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]).toEqual([libby, expect.anything()]);
});

it('falls back to Open Library if the imported cover is missing', async () => {
  mockImageConversion();
  const libby = 'https://img2.od-cdn.com/ImageType-100/example.JPG';
  const openLibrary = 'https://covers.openlibrary.org/b/id/42-M.jpg';
  const request = vi.fn(async (url: string) => url === libby ? new Response('', { status: 404 }) : new Response('a', { headers: { 'Content-Type': 'image/jpeg' } }));
  expect(await loadFirstCover([libby, openLibrary], request as typeof fetch)).toMatchObject({ url: openLibrary, missing: [libby] });
  expect(request).toHaveBeenCalledTimes(2);
});

it('rejects unrelated URLs in an imported file', async () => {
  const request = vi.fn();
  expect(await loadCoverResult('https://example.org/private.png', request as typeof fetch)).toEqual({ status: 'error' });
  expect(request).not.toHaveBeenCalled();
});
