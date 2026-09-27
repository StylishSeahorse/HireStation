import { Cents, gstOn, gstWithin, toCents } from './money.js';

export interface PricedLine {
  key: string;
  description: string;
  quantity: number;
  unitCost: Cents; // GST-exclusive
  days: number;
  taxable: boolean;
  kind: 'HIRE' | 'DAMAGE' | 'LATE_FEE' | 'BOND_FORFEIT' | 'LABOUR' | 'DISCOUNT' | 'DELIVERY';
}

export interface Totals {
  lines: (PricedLine & { lineTotal: Cents; gst: Cents })[];
  subtotal: Cents;
  gstTotal: Cents;
  total: Cents;
}

export interface TaxSettings {
  gstRegistered: boolean;
  gstRate: number; // percent
}

/** Line totals are GST-exclusive; GST is added per taxable line when the business is registered. */
export function computeTotals(lines: PricedLine[], tax: TaxSettings): Totals {
  const out = lines.map((l) => {
    const lineTotal = Math.round(l.quantity * l.days * l.unitCost);
    const gst = tax.gstRegistered && l.taxable ? gstOn(lineTotal, tax.gstRate) : 0;
    return { ...l, lineTotal, gst };
  });
  const subtotal = out.reduce((a, l) => a + l.lineTotal, 0);
  const gstTotal = out.reduce((a, l) => a + l.gst, 0);
  return { lines: out, subtotal, gstTotal, total: subtotal + gstTotal };
}

type Num = number | string | { toString(): string };

export interface UsageInput {
  equipment: { id: string; name: string; gstTaxable: boolean }[];
  returnLines: { equipmentId: string; qtyOut: number; qtyReturned: number; dailyRate: Num; days: Num; damageCharge: Num; damageNotes?: string | null }[];
  lateFee: Num;
  discountPercent: Num;
  bondForfeited: Num; // GST-inclusive amount retained from the bond
  staff?: { name: string; role: string; rate: Num | null; hours: Num | null }[];
  deliveryFee?: Num; // delivery / setup / collection, ex GST (not discounted)
}

/**
 * Build invoice lines from what was actually used (the return inventory),
 * never from the originally booked list. Held bonds are excluded entirely;
 * only a forfeited portion becomes a (taxable) line.
 */
export function usageLines(input: UsageInput, tax: TaxSettings): PricedLine[] {
  const eq = new Map(input.equipment.map((e) => [e.id, e]));
  const lines: PricedLine[] = [];
  let hireTaxable = 0;
  let hireExempt = 0;
  for (const r of input.returnLines) {
    const e = eq.get(r.equipmentId);
    if (!e || r.qtyOut <= 0) continue;
    const line: PricedLine = {
      key: `hire:${r.equipmentId}`, description: e.name, quantity: r.qtyOut,
      unitCost: toCents(r.dailyRate), days: Number(r.days.toString()), taxable: e.gstTaxable, kind: 'HIRE',
    };
    lines.push(line);
    const t = Math.round(line.quantity * line.days * line.unitCost);
    if (e.gstTaxable) hireTaxable += t; else hireExempt += t;
  }
  for (const s of input.staff ?? []) {
    if (!s.rate || !s.hours) continue;
    lines.push({ key: `labour:${s.name}`, description: `${s.role} — ${s.name}`, quantity: Number(s.hours.toString()), unitCost: toCents(s.rate), days: 1, taxable: true, kind: 'LABOUR' });
  }
  const discount = Number(input.discountPercent.toString());
  if (discount > 0) {
    const pct = (v: number) => -Math.round((v * discount) / 100);
    if (hireTaxable) lines.push({ key: 'discount:taxable', description: `Discount (${discount}%)`, quantity: 1, unitCost: pct(hireTaxable), days: 1, taxable: true, kind: 'DISCOUNT' });
    if (hireExempt) lines.push({ key: 'discount:exempt', description: `Discount (${discount}%) — GST-free items`, quantity: 1, unitCost: pct(hireExempt), days: 1, taxable: false, kind: 'DISCOUNT' });
  }
  for (const r of input.returnLines) {
    const charge = toCents(r.damageCharge);
    if (charge <= 0) continue;
    const e = eq.get(r.equipmentId);
    const missing = r.qtyOut - r.qtyReturned;
    const label = missing > 0 ? `Loss/damage charge — ${e?.name ?? 'item'} (${missing} not returned)` : `Damage charge — ${e?.name ?? 'item'}`;
    lines.push({ key: `damage:${r.equipmentId}`, description: r.damageNotes ? `${label}: ${r.damageNotes}` : label, quantity: 1, unitCost: charge, days: 1, taxable: true, kind: 'DAMAGE' });
  }
  const delivery = toCents(input.deliveryFee ?? 0);
  if (delivery > 0) lines.push({ key: 'delivery', description: 'Delivery, setup and collection', quantity: 1, unitCost: delivery, days: 1, taxable: true, kind: 'DELIVERY' });
  const late = toCents(input.lateFee);
  if (late > 0) lines.push({ key: 'late', description: 'Late return fee', quantity: 1, unitCost: late, days: 1, taxable: true, kind: 'LATE_FEE' });
  const forfeit = toCents(input.bondForfeited);
  if (forfeit > 0) {
    // A forfeited bond is consideration for damage/loss; the retained amount is GST-inclusive.
    const exclusive = tax.gstRegistered ? forfeit - gstWithin(forfeit, tax.gstRate) : forfeit;
    lines.push({ key: 'bond', description: 'Forfeited security bond (applied to damage/loss)', quantity: 1, unitCost: exclusive, days: 1, taxable: true, kind: 'BOND_FORFEIT' });
  }
  return lines;
}
