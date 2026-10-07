import { describe, expect, it } from 'vitest';
import { BinaryBitmap, Code128Reader, HybridBinarizer, RGBLuminanceSource } from '@zxing/library';
import { code128Svg, code128Widths, QUIET_ZONE } from './code128';

// Rasterise the bars and read them back with the same decoder the camera scanner uses.
function decode(text: string) {
  const widths = code128Widths(text);
  const px = 3;
  const modules = widths.reduce((a, b) => a + b, 0) + 2 * QUIET_ZONE;
  const w = modules * px;
  const h = 40;
  const row = new Uint8ClampedArray(w).fill(255);
  let x = QUIET_ZONE * px;
  widths.forEach((m, i) => { if (i % 2 === 0) row.fill(0, x, x + m * px); x += m * px; });
  const lum = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) lum.set(row, y * w);
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h)));
  return new Code128Reader().decode(bitmap).getText();
}

describe('code128', () => {
  it('round-trips generated, unit, typed and numeric codes', () => {
    for (const code of ['EQ00001', 'EQ00042-03', 'XLR-10M', 'A', '12345678', '9300000000017', 'cable #7 (blue)'])
      expect(decode(code)).toBe(code);
  });

  it('every symbol is 11 modules wide', () => {
    const w = code128Widths('EQ00001');
    // start + 7 chars + check = 9 symbols of 11, then the 13-module stop
    expect(w.reduce((a, b) => a + b, 0)).toBe(9 * 11 + 13);
  });

  it('refuses characters a label cannot carry', () => {
    expect(() => code128Widths('é')).toThrow();
    expect(() => code128Widths('')).toThrow();
  });

  it('renders an SVG with escaped label text', () => {
    const svg = code128Svg('A&B');
    expect(svg).toContain('aria-label="A&amp;B"');
    expect(svg.startsWith('<svg')).toBe(true);
  });
});
