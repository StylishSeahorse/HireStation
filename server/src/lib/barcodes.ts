import type { Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from './auth.js';

type Db = PrismaClient | Prisma.TransactionClient;

// Generated codes: EQ00001, EQ00002, … for products; units add a suffix (EQ00001-01, -02, …).
// Short, uppercase Code 128-friendly text, so labels stay small enough to wrap round a cable.
const PREFIX = 'EQ';
const PRODUCT_CODE = /^EQ(\d{5,})$/;

/** Scanners return exactly what's printed; store codes trimmed and uppercase so lookups match. */
export function normaliseBarcode(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toUpperCase();
  if (!s) return null;
  // Code 128 (set B) can print any of these; anything else can't go on a label.
  if (!/^[\x20-\x7E]{1,40}$/.test(s)) throw new HttpError(400, 'Barcodes can only contain letters, numbers and common symbols (up to 40 characters)');
  return s;
}

/** A code must be unique across products and units, so one scan always means one thing. */
export async function assertBarcodeFree(db: Db, code: string | null | undefined, own: { equipmentId?: string; unitId?: string } = {}) {
  if (!code) return;
  const [e, u] = await Promise.all([
    db.equipment.findFirst({ where: { barcode: code, ...(own.equipmentId ? { id: { not: own.equipmentId } } : {}) }, select: { name: true } }),
    db.equipmentUnit.findFirst({ where: { barcode: code, ...(own.unitId ? { id: { not: own.unitId } } : {}) }, select: { serialNumber: true, equipment: { select: { name: true } } } }),
  ]);
  if (e) throw new HttpError(409, `Barcode ${code} is already used by ${e.name}`);
  if (u) throw new HttpError(409, `Barcode ${code} is already used by ${u.equipment.name} (unit ${u.serialNumber})`);
}

async function codeTaken(db: Db, code: string) {
  const [e, u] = await Promise.all([db.equipment.count({ where: { barcode: code } }), db.equipmentUnit.count({ where: { barcode: code } })]);
  return e + u > 0;
}

/**
 * Give every product (and every unit of a serialised product) that has no barcode a generated one.
 * Existing codes, including ones typed in by hand, are left alone.
 */
export async function generateMissingBarcodes(db: Db, equipmentIds?: string[]) {
  const scope = equipmentIds?.length ? { id: { in: equipmentIds } } : {};
  const items = await db.equipment.findMany({
    where: { archived: false, ...scope },
    select: { id: true, barcode: true, serialised: true, units: { select: { id: true, barcode: true, retired: true }, orderBy: { serialNumber: 'asc' } } },
    orderBy: { name: 'asc' },
  });
  const existing = await db.equipment.findMany({ where: { barcode: { startsWith: PREFIX } }, select: { barcode: true } });
  let next = Math.max(0, ...existing.map((e) => Number(PRODUCT_CODE.exec(e.barcode ?? '')?.[1] ?? 0))) + 1;
  let products = 0;
  let units = 0;
  for (const item of items) {
    let base = item.barcode;
    if (!base) {
      do base = `${PREFIX}${String(next++).padStart(5, '0')}`; while (await codeTaken(db, base));
      await db.equipment.update({ where: { id: item.id }, data: { barcode: base } });
      products++;
    }
    if (!item.serialised) continue;
    let n = 1;
    for (const unit of item.units) {
      if (unit.barcode || unit.retired) continue;
      let code: string;
      do code = `${base}-${String(n++).padStart(2, '0')}`; while (await codeTaken(db, code));
      await db.equipmentUnit.update({ where: { id: unit.id }, data: { barcode: code } });
      units++;
    }
  }
  return { products, units };
}
