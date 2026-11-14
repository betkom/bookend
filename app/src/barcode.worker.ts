import { createIsbnReader, decodeBarcodeFrame } from './barcodeReader';

const reader = createIsbnReader();
// ZXing handles horizontal and vertical bars. Try only one extra angle per
// frame so other orientations get covered without delaying every capture.
const retryAngles = [0, -15, 15, -30, 30, -45, 45];
let nextAngle = 0;
self.onmessage = (event: MessageEvent<{ pixels: Uint8ClampedArray; width: number; height: number }>) => {
  try {
    const { pixels, width, height } = event.data;
    const angle = retryAngles[nextAngle];
    nextAngle = (nextAngle + 1) % retryAngles.length;
    self.postMessage(decodeBarcodeFrame(reader, pixels, width, height, angle) ?? { isbn: null });
  } catch {
    self.postMessage({ error: 'Barcode recognition failed. Try scanning again, or type the ISBN.' });
  }
};
