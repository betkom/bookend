import { normaliseIsbn } from './isbn';

/**
 * Scans ISBN barcodes from the camera. Uses the native BarcodeDetector API when
 * available (Chrome/Android, Safari 17+ on some platforms) and falls back to ZXing.
 */

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts: { formats: string[] }): NativeDetector;
      getSupportedFormats(): Promise<string[]>;
    };
  }
}

export interface ScanHandle {
  stop(): void;
}

async function nativeDetector(): Promise<NativeDetector | null> {
  const BD = window.BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = await BD.getSupportedFormats();
    if (!formats.includes('ean_13')) return null;
    return new BD({ formats: ['ean_13'] });
  } catch {
    return null;
  }
}

/**
 * Start scanning into the given <video>. Calls onIsbn once with the first valid
 * ISBN found, then stops the camera.
 */
export async function startIsbnScan(
  video: HTMLVideoElement,
  onIsbn: (isbn: string) => void,
  onError: (message: string) => void,
): Promise<ScanHandle> {
  const detector = await nativeDetector();

  if (detector) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      onError('Camera access was denied or is unavailable.');
      return { stop() {} };
    }
    video.srcObject = stream;
    await video.play();
    let stopped = false;
    const stop = () => {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };

    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        for (const c of codes) {
          const isbn = normaliseIsbn(c.rawValue);
          if (isbn) {
            stop();
            onIsbn(isbn);
            return;
          }
        }
      } catch {
        /* frame not ready; keep trying */
      }
      setTimeout(tick, 200);
    };
    tick();
    return { stop };
  }

  // Fallback: ZXing, loaded lazily so browsers with native support don't download it.
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();
    let done = false;
    const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
      if (done || !result) return;
      const isbn = normaliseIsbn(result.getText());
      if (isbn) {
        done = true;
        controls.stop();
        onIsbn(isbn);
      }
    });
    return { stop: () => controls.stop() };
  } catch {
    onError('Could not start the camera. You can type the ISBN or search by title instead.');
    return { stop() {} };
  }
}

