import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library';
import { normaliseIsbn } from './isbn';

// RGBLuminanceSource does not implement rotation. Rotate the pixels explicitly
// so dimensions also change correctly for non-square camera frames.
export class BarcodeFrame extends RGBLuminanceSource {
  isRotateSupported() { return true; }
  rotateCounterClockwise(): BarcodeFrame {
    const width = this.getWidth();
    const height = this.getHeight();
    const pixels = this.getMatrix();
    const rotated = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        rotated[(width - x - 1) * height + y] = pixels[y * width + x];
      }
    }
    return new BarcodeFrame(rotated, height, width);
  }
}

export function createIsbnReader() {
  const reader = new MultiFormatReader();
  reader.setHints(new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF]],
    [DecodeHintType.TRY_HARDER, true],
  ]));
  return reader;
}

function straightenFrame(pixels: Uint8ClampedArray, width: number, height: number, degrees: number): BarcodeFrame {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const newWidth = Math.ceil(width * Math.abs(cos) + height * Math.abs(sin));
  const newHeight = Math.ceil(width * Math.abs(sin) + height * Math.abs(cos));
  const rotated = new Uint8ClampedArray(newWidth * newHeight).fill(255);
  for (let y = 0; y < newHeight; y++) {
    const dy = y - newHeight / 2;
    for (let x = 0; x < newWidth; x++) {
      const dx = x - newWidth / 2;
      const sourceX = Math.round(width / 2 + dx * cos + dy * sin);
      const sourceY = Math.round(height / 2 - dx * sin + dy * cos);
      if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
        rotated[y * newWidth + x] = pixels[sourceY * width + sourceX];
      }
    }
  }
  return new BarcodeFrame(rotated, newWidth, newHeight);
}

type BarcodeRead = { rawValue: string; isbn: string | null };

function readBarcode(reader: MultiFormatReader, frame: BarcodeFrame): BarcodeRead | null {
  try {
    const rawValue = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(frame))).getText();
    return { rawValue, isbn: normaliseIsbn(rawValue) };
  } catch (error) {
    const kind = (error as { getKind?: () => string }).getKind?.();
    if (['NotFoundException', 'ChecksumException', 'FormatException'].includes(kind ?? '')) return null;
    throw error;
  }
}

export function decodeBarcodeFrame(
  reader: MultiFormatReader,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  retryAngle = 0,
): BarcodeRead | null {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] = (pixels[offset] + 2 * pixels[offset + 1] + pixels[offset + 2]) / 4;
  }
  const result = readBarcode(reader, new BarcodeFrame(gray, width, height));
  if (result?.isbn || !retryAngle) return result;

  const retry = readBarcode(reader, straightenFrame(gray, width, height, retryAngle));
  return retry?.isbn ? retry : result ?? retry;
}
