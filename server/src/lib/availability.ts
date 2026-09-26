import { prisma } from './db.js';
import type { BookingStatus } from '@prisma/client';

// Enquiries and cancellations do not hold stock; everything else does.
export const NON_BLOCKING: BookingStatus[] = ['ENQUIRY', 'CANCELLED', 'CONTRACT_DECLINED'];

export interface Allocation {
  equipmentId: string;
  stock: number;
  allocated: number;
  available: number;
  bookings: { id: string; reference: string; title: string; qty: number; loadIn: Date; loadOut: Date; status: BookingStatus }[];
}

/**
 * Stock allocated per equipment item across bookings overlapping [start, end).
 * A booking's hold uses what actually left the warehouse once departure is recorded,
 * and is released once the return is completed.
 */
export async function allocations(start: Date, end: Date, opts: { equipmentIds?: string[]; excludeBookingId?: string } = {}): Promise<Map<string, Allocation>> {
  const [equipment, bookings] = await Promise.all([
    prisma.equipment.findMany({
      where: { archived: false, ...(opts.equipmentIds ? { id: { in: opts.equipmentIds } } : {}) },
      select: { id: true, stockQuantity: true, serialised: true, _count: { select: { units: { where: { retired: false } } } } },
    }),
    prisma.booking.findMany({
      where: {
        loadIn: { lt: end }, loadOut: { gt: start }, status: { notIn: NON_BLOCKING },
        ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
      },
      select: {
        id: true, reference: true, title: true, loadIn: true, loadOut: true, status: true,
        lineItems: { select: { equipmentId: true, qtyBooked: true } },
        departure: { select: { completed: true, lines: { select: { equipmentId: true, qtyOut: true } } } },
        returnInventory: { select: { completed: true, lines: { select: { equipmentId: true, qtyOut: true, qtyReturned: true } } } },
      },
    }),
  ]);
  const map = new Map<string, Allocation>();
  for (const e of equipment) {
    const stock = e.serialised ? e._count.units : e.stockQuantity;
    map.set(e.id, { equipmentId: e.id, stock, allocated: 0, available: stock, bookings: [] });
  }
  for (const b of bookings) {
    let lines: { equipmentId: string; qty: number }[];
    if (b.returnInventory?.completed) {
      // Only unreturned (lost) items remain held against this booking.
      lines = b.returnInventory.lines.map((l) => ({ equipmentId: l.equipmentId, qty: Math.max(0, l.qtyOut - l.qtyReturned) }));
    } else if (b.departure?.completed) {
      lines = b.departure.lines.map((l) => ({ equipmentId: l.equipmentId, qty: l.qtyOut }));
    } else {
      lines = b.lineItems.map((l) => ({ equipmentId: l.equipmentId, qty: l.qtyBooked }));
    }
    for (const l of lines) {
      const a = map.get(l.equipmentId);
      if (!a || l.qty <= 0) continue;
      a.allocated += l.qty;
      a.available = a.stock - a.allocated;
      a.bookings.push({ id: b.id, reference: b.reference, title: b.title, qty: l.qty, loadIn: b.loadIn, loadOut: b.loadOut, status: b.status });
    }
  }
  return map;
}

/** Items in `requested` that exceed free stock for the window. */
export async function conflictsFor(start: Date, end: Date, requested: { equipmentId: string; qty: number }[], excludeBookingId?: string) {
  const ids = [...new Set(requested.map((r) => r.equipmentId))];
  const alloc = await allocations(start, end, { equipmentIds: ids, excludeBookingId });
  const names = new Map((await prisma.equipment.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));
  const totals = new Map<string, number>();
  for (const r of requested) totals.set(r.equipmentId, (totals.get(r.equipmentId) ?? 0) + r.qty);
  const out = [];
  for (const [id, qty] of totals) {
    const a = alloc.get(id);
    if (!a) continue;
    if (qty > a.available) out.push({ equipmentId: id, name: names.get(id), requested: qty, available: Math.max(0, a.available), stock: a.stock, shortBy: qty - Math.max(0, a.available), bookings: a.bookings });
  }
  return out;
}
