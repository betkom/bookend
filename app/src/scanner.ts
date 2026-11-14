import { normaliseIsbn } from './isbn';

export interface ScanHandle {
  stop(): void;
}

type FocusConstraint = MediaTrackConstraintSet & { focusMode: 'continuous' };

async function requestContinuousFocus(track: MediaStreamTrack | undefined) {
  try {
    const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
    if (!track || !capabilities?.focusMode?.includes('continuous')) return;

    const constraints = track.getConstraints();
    const focus: FocusConstraint = { focusMode: 'continuous' };
    await track.applyConstraints({ ...constraints, advanced: [...(constraints.advanced ?? []), focus] });
  } catch {
    // A focus request is optional. Keep scanning with the camera's current settings.
  }
}

/** Call onIsbn once for the first valid ISBN, then release the camera. */
export async function startIsbnScan(
  video: HTMLVideoElement,
  onIsbn: (isbn: string) => void,
  onError: (message: string) => void,
  signal?: AbortSignal,
  onStatus?: (message: string) => void,
): Promise<ScanHandle> {
  let stopped = false;
  let stream: MediaStream | undefined;
  let decoder: ScanHandle | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    decoder?.stop();
    stream?.getTracks().forEach((track) => track.stop());
    if (stream && video.srcObject === stream) video.srcObject = null;
    signal?.removeEventListener('abort', stop);
  };
  const handle = { stop };
  const fail = (message: string) => {
    if (stopped) return;
    stop();
    onError(message);
  };
  const accept = (raw: string) => {
    if (stopped) return false;
    const isbn = normaliseIsbn(raw);
    if (!isbn) {
      onStatus?.(`Read barcode ${raw.slice(0, 80)}, but it is not a valid ISBN-10 or ISBN-13.`);
      return false;
    }
    stop();
    onIsbn(isbn);
    return true;
  };

  if (signal?.aborted) return handle;
  signal?.addEventListener('abort', stop, { once: true });
  if (!navigator.mediaDevices?.getUserMedia) {
    fail('Camera access is unavailable. Open Bookend over HTTPS, or type the ISBN instead.');
    return handle;
  }

  onStatus?.('Requesting camera access…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    // Permission can finish after the user has closed the scanner.
    if (stopped) {
      stream.getTracks().forEach((track) => track.stop());
      return handle;
    }
    void requestContinuousFocus(stream.getVideoTracks()[0]);
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    // A play() promise may remain pending even when camera frames exist.
    // Start frame acquisition independently; the decoder checks readiness.
    void video.play().catch(() => {
      fail('Could not play the camera preview. Stop and restart the scanner.');
    });
  } catch (error) {
    const denied = error instanceof Error && error.name === 'NotAllowedError';
    fail(denied
      ? 'Camera access was denied. Allow camera access in your browser settings, then try again.'
      : 'Could not start the camera. You can type the ISBN or search by title instead.');
    return handle;
  }

  try {
    const { scanCameraFrames } = await import('./cameraDecoder');
    if (!stopped) {
      const controls = scanCameraFrames(video, accept, fail, onStatus);
      if (stopped) controls.stop();
      else decoder = controls;
    }
  } catch {
    fail('Could not start barcode recognition. Try again, or type the ISBN.');
  }
  return handle;
}
