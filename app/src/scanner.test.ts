import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startIsbnScan } from './scanner';

const decode = vi.hoisted(() => vi.fn());
vi.mock('./cameraDecoder', () => ({ scanCameraFrames: decode }));

const ISBN = '9780141439518';
const frameControls = { stop: vi.fn() };
let stopTrack: ReturnType<typeof vi.fn>;
let stream: MediaStream;
let readCapabilities: ReturnType<typeof vi.fn>;
let applyConstraints: ReturnType<typeof vi.fn>;
let video: HTMLVideoElement;
let getUserMedia: ReturnType<typeof vi.fn>;
let onIsbn: ReturnType<typeof vi.fn>;
let onError: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  stopTrack = vi.fn();
  readCapabilities = vi.fn().mockReturnValue({});
  applyConstraints = vi.fn().mockResolvedValue(undefined);
  const track = {
    stop: stopTrack,
    getCapabilities: readCapabilities,
    getConstraints: () => ({ width: { ideal: 1920 }, facingMode: { ideal: 'environment' } }),
    applyConstraints,
  };
  stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
  getUserMedia = vi.fn().mockResolvedValue(stream);
  onIsbn = vi.fn();
  onError = vi.fn();
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  decode.mockReset().mockReturnValue(frameControls);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ISBN camera scanner', () => {
  it('captures a result delivered before decoder startup returns', async () => {
    decode.mockImplementation((_video, callback) => {
      callback(ISBN);
      return frameControls;
    });
    await startIsbnScan(video, onIsbn, onError);
    expect(onIsbn).toHaveBeenCalledOnce();
    expect(onIsbn).toHaveBeenCalledWith(ISBN);
    expect(onError).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(frameControls.stop).toHaveBeenCalled();
    expect(video.play).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  });

  it('keeps reading after ordinary misses and invalid book codes, and accepts only one ISBN', async () => {
    const handle = await startIsbnScan(video, onIsbn, onError);
    const callback = decode.mock.calls[0][1];

    callback('4006381333931');
    callback('9780141439519');
    expect(onIsbn).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    callback(ISBN);
    callback(ISBN);
    handle.stop();
    expect(onIsbn).toHaveBeenCalledOnce();
    expect(onIsbn).toHaveBeenCalledWith(ISBN);
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('reports fatal decoding errors instead of leaving a stalled preview', async () => {
    await startIsbnScan(video, onIsbn, onError);
    decode.mock.calls[0][2]('Canvas unavailable');
    expect(onError).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('requests continuous focus without changing the existing camera constraints', async () => {
    readCapabilities.mockReturnValue({ focusMode: ['manual', 'continuous'] });
    const handle = await startIsbnScan(video, onIsbn, onError);
    expect(applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 1920 },
      facingMode: { ideal: 'environment' },
      advanced: [{ focusMode: 'continuous' }],
    });
    expect(decode).toHaveBeenCalledOnce();
    handle.stop();
  });

  it('scans on cameras without continuous focus', async () => {
    readCapabilities.mockReturnValue({ focusMode: ['manual'] });
    const handle = await startIsbnScan(video, onIsbn, onError);
    expect(applyConstraints).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledOnce();
    handle.stop();
  });

  it('keeps scanning if the browser rejects the focus request', async () => {
    readCapabilities.mockReturnValue({ focusMode: ['continuous'] });
    applyConstraints.mockRejectedValue(new Error('Focus unavailable'));
    const handle = await startIsbnScan(video, onIsbn, onError);
    expect(decode).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    handle.stop();
  });

  it('starts the worker directly without accessing the browser detector', async () => {
    const native = vi.fn(() => { throw new Error('Native detector unavailable'); });
    Object.defineProperty(window, 'BarcodeDetector', { get: native });
    const handle = await startIsbnScan(video, onIsbn, onError);
    expect(native).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    handle.stop();
  });

  it('accepts and normalizes the reported ISBN-10', async () => {
    const handle = await startIsbnScan(video, onIsbn, onError);
    decode.mock.calls[0][1]('9780646922');
    expect(onIsbn).toHaveBeenCalledWith('9789780646929');
    expect(stopTrack).toHaveBeenCalledOnce();
    handle.stop();
  });

  it('releases a camera granted after cancellation without starting the preview', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => { grant = resolve; }));
    const controller = new AbortController();
    const pending = startIsbnScan(video, onIsbn, onError, controller.signal);
    controller.abort();
    grant(stream);
    await pending;
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores a decoder result received after cancellation', async () => {
    const controller = new AbortController();
    await startIsbnScan(video, onIsbn, onError, controller.signal);
    controller.abort();
    decode.mock.calls[0][1](ISBN);
    expect(onIsbn).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(frameControls.stop).toHaveBeenCalledOnce();
  });

  it('starts decoding even if video.play never settles', async () => {
    vi.mocked(video.play).mockReturnValue(new Promise(() => {}));
    const handle = await startIsbnScan(video, onIsbn, onError);
    expect(decode).toHaveBeenCalledOnce();
    decode.mock.calls[0][1]('9780646922');
    expect(onIsbn).toHaveBeenCalledWith('9789780646929');
    handle.stop();
  });

  it('cleans up after video playback fails', async () => {
    vi.mocked(video.play).mockRejectedValue(new Error('Playback failed'));
    await startIsbnScan(video, onIsbn, onError);
    expect(onError).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it('explains denied camera permission', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('Denied'), { name: 'NotAllowedError' }));
    await startIsbnScan(video, onIsbn, onError);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Allow camera access'));
  });

  it('explains unavailable camera APIs', async () => {
    vi.stubGlobal('navigator', {});
    await startIsbnScan(video, onIsbn, onError);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('HTTPS'));
  });
});
