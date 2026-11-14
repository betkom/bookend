import { describe, expect, it } from 'vitest';
import { BinaryBitmap, HybridBinarizer, MultiFormatReader } from '@zxing/library';
import { BarcodeFrame, createIsbnReader, decodeBarcodeFrame } from './barcodeReader';

// EAN-13 modules for 9780141439518, including guards, excluding quiet zones.
const modules = '10101110110001001010011100110010011101001100101010101110010000101110100100111011001101001000101';

function barcode(top: number, mirrored = false, encoded = modules) {
  const width = 640;
  const height = 480;
  const pixels = new Uint8ClampedArray(width * height).fill(255);
  const bars = mirrored ? [...encoded].reverse().join('') : encoded;
  for (let y = top; y < top + 50; y++) {
    for (let x = 0; x < bars.length * 4; x++) {
      pixels[y * width + 130 + x] = bars[Math.floor(x / 4)] === '1' ? 0 : 255;
    }
  }
  return new BarcodeFrame(pixels, width, height);
}
const bitmap = (frame: BarcodeFrame) => new BinaryBitmap(new HybridBinarizer(frame));

describe('real ISBN barcode decoding', () => {
  it('reads the reported ISBN-10 from a Code 128 barcode', () => {
    // Code set C: start, 97, 80, 64, 69, 22, checksum 13, stop.
    const encoded = '110100111001111010100010100111100101000011001011001000011001110100100110111001100011101011';
    const frame = barcode(215, false, encoded);
    const pixels = new Uint8ClampedArray(frame.getMatrix().length * 4);
    frame.getMatrix().forEach((value, i) => pixels.set([value, value, value, 255], i * 4));
    expect(decodeBarcodeFrame(createIsbnReader(), pixels, 640, 480)).toEqual({
      rawValue: '9780646922', isbn: '9789780646929',
    });
  });

  it('decodes a centered barcode from pixels', () => {
    expect(createIsbnReader().decodeWithState(bitmap(barcode(215))).getText()).toBe('9780141439518');
  });

  it('decodes near the edge where the old reader misses the barcode', () => {
    expect(() => new MultiFormatReader().decode(bitmap(barcode(30)))).toThrow();
    expect(createIsbnReader().decodeWithState(bitmap(barcode(30))).getText()).toBe('9780141439518');
  });

  it('decodes a sideways barcode that the old reader cannot capture', () => {
    const frame = barcode(215).rotateCounterClockwise();
    expect(() => new MultiFormatReader().decode(bitmap(frame))).toThrow();
    expect(createIsbnReader().decodeWithState(bitmap(frame)).getText()).toBe('9780141439518');
  });

  it('decodes RGBA camera pixels through the worker entry point', () => {
    const frame = barcode(215);
    const pixels = new Uint8ClampedArray(frame.getMatrix().length * 4);
    frame.getMatrix().forEach((value, i) => pixels.set([value, value, value, 255], i * 4));
    expect(decodeBarcodeFrame(createIsbnReader(), pixels, 640, 480)).toEqual({ rawValue: '9780141439518', isbn: '9780141439518' });
    pixels.fill(255);
    expect(decodeBarcodeFrame(createIsbnReader(), pixels, 640, 480)).toBeNull();
  });

  it('reads a narrow barcode tilted in the camera frame', () => {
    const width = 640;
    const height = 480;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const angle = Math.PI / 6;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const barX = (x - 320) * cos + (y - 240) * sin + modules.length * 1.5;
        const barY = (y - 240) * cos - (x - 320) * sin;
        if (Math.abs(barY) < 22 && modules[Math.floor(barX / 3)] === '1') {
          const i = (y * width + x) * 4;
          pixels.fill(0, i, i + 3);
        }
      }
    }
    expect(decodeBarcodeFrame(createIsbnReader(), pixels, width, height)).toBeNull();
    expect(decodeBarcodeFrame(createIsbnReader(), pixels, width, height, -30)).toEqual({
      rawValue: '9780141439518', isbn: '9780141439518',
    });
  });

  it('decodes a mirrored barcode from a front camera', () => {
    expect(createIsbnReader().decodeWithState(bitmap(barcode(215, true))).getText()).toBe('9780141439518');
  });
});
