import { describe, it, expect } from 'vitest';
import { placeEquipment, sectionFor } from './agreement.js';
import { computeTotals, usageLines } from './pricing.js';

const cat = (name: string, parent?: string) => ({ name, parent: parent ? { name: parent } : null });
const line = (name: string, category: ReturnType<typeof cat> | null, qty = 1, value = 100, conditionNote: string | null = null) =>
  ({ equipment: { name, replacementValue: value, category }, qtyBooked: qty, conditionNote });

describe('agreement sections', () => {
  it('maps categories (or their parent) to Sound / Lighting / Visual / Cables / Staging', () => {
    expect(sectionFor(cat('Sound'))).toBe('sound');
    expect(sectionFor(cat('Speakers'))).toBe('sound');
    expect(sectionFor(cat('Moving heads', 'Lighting'))).toBe('lighting');
    expect(sectionFor(cat('LED walls'))).toBe('visual');
    expect(sectionFor(cat('Cables'))).toBe('cables');
    expect(sectionFor(cat('Truss & staging'))).toBe('staging');
    expect(sectionFor(cat('Furniture'))).toBeNull();
    expect(sectionFor(null)).toBeNull();
  });

  it('fills rows per section, defaults condition to Good, uses line replacement value', () => {
    const { values, overflow } = placeEquipment([line('Speaker', cat('Sound'), 2, 2500), line('Mic', cat('Sound'), 1, 300, 'Scuffed grille')], 3);
    expect(values.equipment_sound_01_item).toBe('Speaker');
    expect(values.equipment_sound_01_qty).toBe('2');
    expect(values.equipment_sound_01_cond).toBe('Good');
    expect(values.equipment_sound_01_val).toBe('5,000.00');
    expect(values.equipment_sound_02_cond).toBe('Scuffed grille');
    expect(values.equipment_sound_03_item).toBe(''); // unused rows are sent empty so they're locked
    expect(values.equipment_staging_10_val).toBe('');
    expect(overflow).toHaveLength(0);
    expect(values.equipment_overflow).toBe('None');
  });

  it('reports what does not fit and lists it for the overflow schedule', () => {
    const lines = [1, 2, 3, 4].map((i) => line(`Light ${i}`, cat('Lighting'))).concat([line('Chair', cat('Furniture'), 10, 20)]);
    const r = placeEquipment(lines, 3);
    expect(r.overLimit).toEqual({ lighting: 1, uncategorised: 1 });
    expect(r.values.equipment_overflow).toBe('1 x Light 4 - Good - $100.00\n10 x Chair - Good - $200.00');
  });
});

describe('delivery fee', () => {
  it('is its own taxable line and is not discounted', () => {
    const lines = usageLines({ equipment: [{ id: 'a', name: 'Speaker', gstTaxable: true }], returnLines: [{ equipmentId: 'a', qtyOut: 1, qtyReturned: 1, dailyRate: 100, days: 1, damageCharge: 0 }],
      lateFee: 0, discountPercent: 10, bondForfeited: 0, deliveryFee: 150 }, { gstRegistered: true, gstRate: 10 });
    const t = computeTotals(lines, { gstRegistered: true, gstRate: 10 });
    expect(lines.find((l) => l.kind === 'DELIVERY')?.unitCost).toBe(15000);
    expect(t.subtotal).toBe(10000 - 1000 + 15000);
    expect(t.gstTotal).toBe(2400);
  });
});
