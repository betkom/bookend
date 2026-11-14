import { getScanGuideRegion } from './scanGuide';
import type { ScanHandle } from './scanner';

/** Decode one bounded frame at a time, off the UI thread. */
export function scanCameraFrames(
  video: HTMLVideoElement,
  onIsbn: (isbn: string) => void,
  onError: (message: string) => void,
  onStatus?: (message: string) => void,
): ScanHandle {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create camera frame canvas.');
  const worker = new Worker(new URL('./barcode.worker.ts', import.meta.url), { type: 'module' });
  let stopped = false;
  let frameIndex = 0;
  let checkedFrames = 0;
  let frameDeadline = Date.now() + 8000;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    worker.terminate();
    canvas.width = canvas.height = 0;
  };
  const fail = (message: string) => {
    stop();
    onError(message);
  };
  onStatus?.('Starting barcode recognition…');
  const capture = () => {
    if (stopped) return;
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
      if (Date.now() >= frameDeadline) {
        fail('The camera opened but is not providing images to scan. Stop and restart the scanner.');
        return;
      }
      onStatus?.('Camera opened. Waiting for a camera image…');
      timer = setTimeout(capture, 100);
      return;
    }
    // Start with the guide, then alternate with the full frame so a barcode
    // outside the guide can still be read. Limit pixel transfer on both paths.
    const region = frameIndex++ % 2 === 0
      ? getScanGuideRegion(video)
      : { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
    const scale = Math.min(1, 960 / Math.max(region.width, region.height));
    const width = Math.max(1, Math.round(region.width * scale));
    const height = Math.max(1, Math.round(region.height * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    try {
      context.drawImage(video, region.x, region.y, region.width, region.height, 0, 0, width, height);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      watchdog = setTimeout(() => fail('Barcode recognition stopped responding. Stop and restart the scanner.'), 8000);
      worker.postMessage({ pixels: data, width: canvas.width, height: canvas.height }, [data.buffer]);
    } catch {
      fail('Could not read the camera image. Try scanning again, or type the ISBN.');
    }
  };
  worker.onmessage = (event: MessageEvent<{ isbn?: string; rawValue?: string; error?: string }>) => {
    if (stopped) return;
    clearTimeout(watchdog);
    checkedFrames++;
    frameDeadline = Date.now() + 8000;
    if (event.data.error) fail(event.data.error);
    else if (event.data.isbn) {
      stop();
      onIsbn(event.data.isbn);
    } else {
      if (event.data.rawValue) {
        onStatus?.(`Read barcode ${event.data.rawValue.slice(0, 80)}, but it is not a valid ISBN-10 or ISBN-13. Try the book’s ISBN barcode.`);
      } else {
        onStatus?.(`Scanning · ${checkedFrames} ${checkedFrames === 1 ? 'image' : 'images'} checked. No barcode read yet.`);
      }
      // Backpressure: capture the next frame only after this one is decoded.
      timer = setTimeout(capture, 200);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    if (!stopped) fail('Could not load barcode recognition. Reload Bookend and try again.');
  };
  capture();
  return { stop };
}
