import { describe, expect, it } from 'vitest';
import { BarcodeEntry, scanDeparture, scanReturn } from './scan';

const cable: BarcodeEntry = { code: 'EQ00001', equipmentId: 'cable', unitId: null, name: 'XLR 10m', serialised: false, inactive: false };
const mixer: BarcodeEntry = { code: 'EQ00002', equipmentId: 'mixer', unitId: null, name: 'Mixer', serialised: true, inactive: false };
const mixer1: BarcodeEntry = { code: 'EQ00002-01', equipmentId: 'mixer', unitId: 'm1', name: 'Mixer #SN1', serialised: true, inactive: false };
const mixer2: BarcodeEntry = { code: 'EQ00002-02', equipmentId: 'mixer', unitId: 'm2', name: 'Mixer #SN2', serialised: true, inactive: false };
const stool: BarcodeEntry = { code: 'EQ00003', equipmentId: 'stool', unitId: null, name: 'Stool', serialised: false, inactive: false };

describe('scanDeparture', () => {
  const booked = new Map([['cable', 2], ['mixer', 1]]);
  const start = [{ equipmentId: 'cable', qtyOut: 0, unitIds: [] }, { equipmentId: 'mixer', qtyOut: 0, unitIds: [] }];

  it('counts each scan and flags going over the booked quantity', () => {
    let lines = start;
    const tones = [];
    for (let i = 0; i < 3; i++) { const r = scanDeparture(lines, cable, cable.code, booked); lines = r.lines; tones.push(r.result.tone); }
    expect(lines[0].qtyOut).toBe(3);
    expect(tones).toEqual(['ok', 'ok', 'warn']);
  });

  it('records units and rejects scanning the same unit twice', () => {
    const a = scanDeparture(start, mixer1, mixer1.code, booked);
    expect(a.lines[1]).toMatchObject({ qtyOut: 1, unitIds: ['m1'] });
    const b = scanDeparture(a.lines, mixer1, mixer1.code, booked);
    expect(b.result.tone).toBe('error');
    expect(b.lines).toBe(a.lines);
  });

  it('adds items that were not booked, and rejects unknown codes', () => {
    const a = scanDeparture(start, stool, stool.code, booked);
    expect(a.lines.at(-1)).toMatchObject({ equipmentId: 'stool', qtyOut: 1 });
    expect(a.result.tone).toBe('warn');
    expect(scanDeparture(start, undefined, 'NOPE', booked).result).toMatchObject({ tone: 'error', text: 'Unknown barcode NOPE' });
  });

  it('refuses a retired unit', () => {
    expect(scanDeparture(start, { ...mixer2, inactive: true }, mixer2.code, booked).result.tone).toBe('error');
  });
});

describe('scanReturn', () => {
  const lines = [{ equipmentId: 'cable', qtyOut: 2, qtyReturned: 0 }, { equipmentId: 'mixer', qtyOut: 1, qtyReturned: 0 }];
  const ctx = () => ({ scannedUnits: new Set<string>(), departedUnits: new Map([['mixer', ['m1']]]) });

  it('never counts back more than went out', () => {
    const c = ctx();
    let l = lines;
    for (let i = 0; i < 2; i++) l = scanReturn(l, cable, cable.code, c).lines;
    expect(l[0].qtyReturned).toBe(2);
    const extra = scanReturn(l, cable, cable.code, c);
    expect(extra.result.tone).toBe('error');
    expect(extra.result.text).toMatch(/Scanned twice/);
  });

  it('tracks units, rejects repeats, and warns about a unit that never went out', () => {
    const c = ctx();
    const a = scanReturn(lines, mixer1, mixer1.code, c);
    expect(a.lines[1].qtyReturned).toBe(1);
    expect(c.scannedUnits.has('m1')).toBe(true);
    expect(scanReturn(a.lines, mixer1, mixer1.code, c).result.text).toMatch(/already scanned/);
    expect(scanReturn(lines, mixer2, mixer2.code, ctx()).result.tone).toBe('warn');
  });

  it('rejects items that were not on the hire', () => {
    expect(scanReturn(lines, stool, stool.code, ctx()).result.tone).toBe('error');
  });

  it('counts a serialised product scanned by its product label, with a warning', () => {
    expect(scanReturn(lines, mixer, mixer.code, ctx()).result.tone).toBe('warn');
  });
});
