// Code 128 barcode encoder. Every handheld scanner reads it and it prints compactly, so a label
// fits round a cable. Output is plain SVG, so labels need no image library.

// Bar/space widths (in modules) for symbol values 0–105; STOP is the 13-module stop pattern.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const STOP = '2331112';
const START_B = 104;
const START_C = 105;
export const QUIET_ZONE = 10; // modules of white either side, required by scanners

/** Symbol values for `text`: set C (two digits per symbol) for all-digit text, otherwise set B. */
export function code128Values(text: string): number[] {
  if (!text) throw new Error('Nothing to encode');
  let values: number[];
  if (/^(\d\d)+$/.test(text)) {
    values = [START_C];
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    values = [START_B];
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error(`Can't encode "${ch}" in a barcode`);
      values.push(c - 32);
    }
  }
  const check = values.reduce((sum, v, i) => sum + v * (i || 1), 0) % 103;
  return [...values, check];
}

/** Alternating bar/space widths, starting with a bar, without quiet zones. */
export function code128Widths(text: string): number[] {
  return [...code128Values(text).map((v) => PATTERNS[v]).join(''), ...STOP].map(Number);
}

/** An SVG barcode; scale it with CSS width (the bars keep their proportions). */
export function code128Svg(text: string, opts: { height?: number } = {}): string {
  const widths = code128Widths(text);
  const total = widths.reduce((a, b) => a + b, 0) + 2 * QUIET_ZONE;
  const h = opts.height ?? 40;
  let x = QUIET_ZONE;
  let bars = '';
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars += `M${x} 0h${w}v${h}h-${w}z`;
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${h}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="${escapeXml(text)}"><rect width="${total}" height="${h}" fill="#fff"/><path d="${bars}" fill="#000"/></svg>`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}
