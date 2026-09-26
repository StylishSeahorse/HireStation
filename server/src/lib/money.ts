// Money helpers working in integer cents to avoid float drift.
export type Cents = number;

export const toCents = (v: number | string | { toString(): string }): Cents =>
  Math.round(Number(v.toString()) * 100);
export const fromCents = (c: Cents): number => Math.round(c) / 100;

/** GST on a GST-exclusive amount at the configured rate (percent, e.g. 10). */
export function gstOn(exclusive: Cents, ratePercent: number): Cents {
  return Math.round((exclusive * ratePercent) / 100);
}

/** GST component contained in a GST-inclusive amount. */
export function gstWithin(inclusive: Cents, ratePercent: number): Cents {
  return Math.round((inclusive * ratePercent) / (100 + ratePercent));
}
