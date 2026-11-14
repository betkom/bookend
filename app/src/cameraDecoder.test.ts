import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanCameraFrames } from './cameraDecoder';

let worker: FakeWorker;
class FakeWorker {
  onmessage?: (event: { data: { isbn?: string; rawValue?: string; error?: string } }) => void;
  onerror?: (event: { preventDefault: () => void }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { worker = this; }
}
let drawImage: ReturnType<typeof vi.fn>;
let getImageData: ReturnType<typeof vi.fn>;
let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn> };
let video: HTMLVideoElement;

beforeEach(() => {
  vi.useFakeTimers();
  drawImage = vi.fn();
  getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(960 * 540 * 4) }));
  canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage, getImageData })) };
  video = { videoWidth: 1920, videoHeight: 1080, clientWidth: 640, clientHeight: 300, readyState: 4 } as HTMLVideoElement;
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('camera frame worker', () => {
  it('scans the visible guide first, then the full frame after the worker responds', async () => {
    const handle = scanCameraFrames(video, vi.fn(), vi.fn());
    expect(drawImage).toHaveBeenCalledWith(video, 192, 333, 1536, expect.closeTo(414), 0, 0, 960, 259);
    const message = worker.postMessage.mock.calls[0];
    expect(message[0]).toMatchObject({ width: 960, height: 259 });
    expect(message[1]).toEqual([message[0].pixels.buffer]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(worker.postMessage).toHaveBeenCalledOnce();
    worker.onmessage!({ data: {} });
    await vi.advanceTimersByTimeAsync(200);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenLastCalledWith(video, 0, 0, 1920, 1080, 0, 0, 960, 540);
    handle.stop();
  });

  it('maps the guide to a portrait camera cropped into a landscape preview', () => {
    Object.assign(video, { videoWidth: 1080, videoHeight: 1920, clientWidth: 360, clientHeight: 200 });
    const handle = scanCameraFrames(video, vi.fn(), vi.fn());
    expect(drawImage).toHaveBeenCalledWith(
      video, 108, 822, 864, expect.closeTo(276), 0, 0, 864, 276,
    );
    handle.stop();
  });

  it('waits for a video frame before reading pixels', async () => {
    video = { videoWidth: 0, videoHeight: 0, readyState: 0 } as HTMLVideoElement;
    const handle = scanCameraFrames(video, vi.fn(), vi.fn());
    expect(drawImage).not.toHaveBeenCalled();
    Object.assign(video, { videoWidth: 640, videoHeight: 480, readyState: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(drawImage).toHaveBeenCalledWith(
      video, 64, expect.closeTo(129.6), 512, expect.closeTo(220.8), 0, 0, 512, 221,
    );
    handle.stop();
  });

  it('terminates recognition on success and ignores late messages', () => {
    const onIsbn = vi.fn();
    scanCameraFrames(video, onIsbn, vi.fn());
    worker.onmessage!({ data: { isbn: '9780141439518' } });
    worker.onmessage!({ data: { isbn: '9780141439518' } });
    expect(onIsbn).toHaveBeenCalledOnce();
    expect(onIsbn).toHaveBeenCalledWith('9780141439518');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('cancels queued captures and terminates the worker', async () => {
    const handle = scanCameraFrames(video, vi.fn(), vi.fn());
    worker.onmessage!({ data: {} });
    handle.stop();
    handle.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports completed scans and non-ISBN barcodes instead of a silent preview', () => {
    const onStatus = vi.fn();
    const handle = scanCameraFrames(video, vi.fn(), vi.fn(), onStatus);
    worker.onmessage!({ data: {} });
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('1 image checked'));
    worker.onmessage!({ data: { rawValue: '4006381333931' } });
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('not a valid ISBN-10 or ISBN-13'));
    handle.stop();
  });

  it('reports an unresponsive worker rather than keeping the camera running', async () => {
    const onError = vi.fn();
    scanCameraFrames(video, vi.fn(), onError);
    await vi.advanceTimersByTimeAsync(8000);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('stopped responding'));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports a camera that never supplies a frame', async () => {
    video = { videoWidth: 0, videoHeight: 0, readyState: 0 } as HTMLVideoElement;
    const onError = vi.fn();
    scanCameraFrames(video, vi.fn(), onError);
    await vi.advanceTimersByTimeAsync(8000);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('not providing images'));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports worker loading errors and releases resources', () => {
    const onError = vi.fn();
    scanCameraFrames(video, vi.fn(), onError);
    worker.onerror!({ preventDefault: vi.fn() });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Reload Bookend'));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports camera frame capture errors', () => {
    getImageData.mockImplementation(() => { throw new Error('No frame'); });
    const onError = vi.fn();
    scanCameraFrames(video, vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('camera image'));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
