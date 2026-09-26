import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { hireDays } from './dates.js';
import { computeTotals, usageLines, PricedLine, TaxSettings } from './pricing.js';
import { toCents } from './money.js';

export const bookingInclude = {
  client: true,
  lineItems: { include: { equipment: { select: { id: true, name: true, gstTaxable: true, serialised: true, sku: true } } } },
  staff: { include: { staff: { select: { id: true, name: true, email: true } } } },
  departure: { include: { lines: true } },
  returnInventory: { include: { lines: true } },
  contracts: { orderBy: { createdAt: 'desc' }, include: { templateVersion: { select: { version: true, template: { select: { id: true, name: true } } } } } },
  invoices: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.BookingInclude;

export type FullBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BK-${year}-`;
  const last = await prisma.booking.findFirst({ where: { reference: { startsWith: prefix } }, orderBy: { reference: 'desc' }, select: { reference: true } });
  const n = last ? Number(last.reference.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

export const bookingDays = (b: { loadIn: Date; loadOut: Date; eventStart?: Date | null; eventEnd?: Date | null }) =>
  hireDays(b.eventStart ?? b.loadIn, b.eventEnd ?? b.loadOut);

/** Quote from the booked list (used before the event). */
export function quoteLines(b: FullBooking): PricedLine[] {
  return usageLines({
    equipment: b.lineItems.map((l) => l.equipment),
    returnLines: b.lineItems.map((l) => ({ equipmentId: l.equipmentId, qtyOut: l.qtyBooked, qtyReturned: l.qtyBooked, dailyRate: l.dailyRate, days: l.days, damageCharge: 0 })),
    staff: b.staff.map((s) => ({ name: s.staff.name, role: s.role, rate: s.rate, hours: s.hours })),
    lateFee: 0, discountPercent: b.discountPercent, bondForfeited: 0,
  }, { gstRegistered: false, gstRate: 0 });
}

export function quoteTotals(b: FullBooking, tax: TaxSettings) {
  const t = computeTotals(quoteLines(b), tax);
  return { ...t, bond: toCents(b.bondAmount) };
}

/** Final charges from the completed return record — what actually went out and came back. */
export async function usageTotals(b: FullBooking, tax: TaxSettings) {
  if (!b.returnInventory) return null;
  const ids = b.returnInventory.lines.map((l) => l.equipmentId);
  const equipment = await prisma.equipment.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, gstTaxable: true } });
  const lines = usageLines({
    equipment,
    returnLines: b.returnInventory.lines,
    staff: b.staff.map((s) => ({ name: s.staff.name, role: s.role, rate: s.rate, hours: s.hours })),
    lateFee: b.returnInventory.lateFee,
    discountPercent: b.discountPercent,
    bondForfeited: b.bondForfeited,
  }, tax);
  return computeTotals(lines, tax);
}

export async function notify(kind: string, message: string, bookingId?: string) {
  await prisma.notification.create({ data: { kind, message, bookingId } });
}
