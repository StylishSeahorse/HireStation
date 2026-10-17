// Pure scan logic for the departure and return checklists, kept apart from the UI so it's testable.

export interface BarcodeEntry { code: string; equipmentId: string; unitId: string | null; name: string; serialised: boolean; inactive: boolean }
export type ScanTone = 'ok' | 'warn' | 'error';
export interface ScanResult { tone: ScanTone; text: string }

export const normaliseCode = (code: string) => code.trim().toUpperCase();

export interface DepartureLine { equipmentId: string; qtyOut: number | string; unitIds?: string[] }

/** One scan on the departure checklist: count the item out (adding it if it wasn't booked). */
export function scanDeparture(lines: DepartureLine[], entry: BarcodeEntry | undefined, code: string, booked: Map<string, number>): { lines: DepartureLine[]; result: ScanResult } {
  if (!entry) return { lines, result: { tone: 'error', text: `Unknown barcode ${code}` } };
  if (entry.unitId && entry.inactive) return { lines, result: { tone: 'error', text: `${entry.name} is retired; it shouldn't go out` } };
  const next = [...lines];
  let i = next.findIndex((l) => l.equipmentId === entry.equipmentId);
  const added = i < 0;
  if (added) { next.push({ equipmentId: entry.equipmentId, qtyOut: 0, unitIds: [] }); i = next.length - 1; }
  const line = { ...next[i], unitIds: [...(next[i].unitIds ?? [])] };
  const notes: string[] = [];
  if (entry.unitId) {
    if (line.unitIds.includes(entry.unitId)) return { lines, result: { tone: 'error', text: `${entry.name} already scanned` } };
    line.unitIds.push(entry.unitId);
    line.qtyOut = Math.max(line.unitIds.length, Number(line.qtyOut) + 1);
  } else {
    line.qtyOut = Number(line.qtyOut) + 1;
    if (entry.serialised) notes.push('counted without a serial number; scan the unit label to track which one');
  }
  next[i] = line;
  const want = booked.get(entry.equipmentId) ?? 0;
  const n = Number(line.qtyOut);
  const name = entry.unitId ? entry.name.replace(/ #.*$/, '') : entry.name;
  if (added) notes.unshift('not on the booking, added');
  else if (n > want) notes.unshift(`more than the ${want} booked`);
  if (entry.inactive) notes.push('this item is archived');
  return { lines: next, result: { tone: notes.length ? 'warn' : 'ok', text: `${entry.unitId ? entry.name : name}: ${n}${want ? ` of ${want}` : ''}${notes.length ? `. ${cap(notes.join('; '))}` : ''}` } };
}

export interface ReturnLine { equipmentId: string; qtyOut: number; qtyReturned: number | string }

/**
 * One scan on the return checklist. Never counts more back than went out: a scan past that is
 * almost always the same item scanned twice, so it's rejected.
 */
export function scanReturn(
  lines: ReturnLine[], entry: BarcodeEntry | undefined, code: string,
  ctx: { scannedUnits: Set<string>; departedUnits: Map<string, string[]> },
): { lines: ReturnLine[]; result: ScanResult } {
  if (!entry) return { lines, result: { tone: 'error', text: `Unknown barcode ${code}` } };
  const i = lines.findIndex((l) => l.equipmentId === entry.equipmentId);
  if (i < 0) return { lines, result: { tone: 'error', text: `${entry.name} didn't go out on this hire` } };
  const line = lines[i];
  const n = Number(line.qtyReturned);
  const label = entry.unitId ? entry.name.replace(/ #.*$/, '') : entry.name;
  const notes: string[] = [];
  if (entry.unitId) {
    if (ctx.scannedUnits.has(entry.unitId)) return { lines, result: { tone: 'error', text: `${entry.name} already scanned` } };
    const departed = ctx.departedUnits.get(entry.equipmentId) ?? [];
    if (departed.length && !departed.includes(entry.unitId)) notes.push('this unit wasn’t recorded going out');
  } else if (entry.serialised) {
    notes.push('counted without a serial number');
  }
  if (n >= line.qtyOut) return { lines, result: { tone: 'error', text: `All ${line.qtyOut} ${label} already scanned back. Scanned twice?` } };
  if (entry.unitId) ctx.scannedUnits.add(entry.unitId);
  const next = [...lines];
  next[i] = { ...line, qtyReturned: n + 1 };
  return { lines: next, result: { tone: notes.length ? 'warn' : 'ok', text: `${entry.unitId ? entry.name : label}: ${n + 1} of ${line.qtyOut}${notes.length ? `. ${cap(notes.join('; '))}` : ''}` } };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
