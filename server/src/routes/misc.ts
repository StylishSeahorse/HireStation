import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { allocations } from '../lib/availability.js';
import { hireDays } from '../lib/dates.js';

export async function miscRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  app.get<{ Querystring: { q: string } }>('/api/search', async (req) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return { equipment: [], clients: [], bookings: [] };
    const ci = { contains: q, mode: 'insensitive' as const };
    const [equipment, clients, bookings] = await Promise.all([
      prisma.equipment.findMany({ where: { archived: false, OR: [{ name: ci }, { sku: ci }, { tags: { has: q.toLowerCase() } }] }, take: 8, select: { id: true, name: true, sku: true } }),
      prisma.client.findMany({ where: { OR: [{ name: ci }, { email: ci }, { contactName: ci }] }, take: 8, select: { id: true, name: true, email: true } }),
      prisma.booking.findMany({ where: { OR: [{ title: ci }, { reference: ci }, { venue: ci }, { client: { name: ci } }] }, take: 8, orderBy: { loadIn: 'desc' }, select: { id: true, reference: true, title: true, loadIn: true, status: true } }),
    ]);
    return { equipment, clients, bookings };
  });

  app.get('/api/notifications', () => prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }));
  app.post('/api/notifications/read', async () => { await prisma.notification.updateMany({ where: { read: false }, data: { read: true } }); return { ok: true }; });

  app.get('/api/dashboard', async () => {
    const now = new Date();
    const week = new Date(now.getTime() + 7 * 86_400_000);
    const [upcoming, unsigned, unreturned, bondsHeld, unpaid] = await Promise.all([
      prisma.booking.findMany({ where: { loadIn: { gte: now, lt: week }, status: { notIn: ['CANCELLED', 'ENQUIRY'] } }, orderBy: { loadIn: 'asc' }, include: { client: { select: { name: true } } } }),
      prisma.contract.count({ where: { status: { in: ['SENT', 'VIEWED'] } } }),
      prisma.booking.findMany({ where: { loadOut: { lt: now }, departure: { completed: true }, OR: [{ returnInventory: null }, { returnInventory: { completed: false } }], status: { not: 'CANCELLED' } }, include: { client: { select: { name: true } } } }),
      prisma.booking.aggregate({ where: { bondStatus: 'HELD' }, _sum: { bondAmount: true }, _count: true }),
      prisma.invoice.aggregate({ where: { status: { in: ['SENT', 'PARTIAL'] }, kind: { not: 'CREDIT' } }, _sum: { total: true, amountPaid: true } }),
    ]);
    return {
      upcoming, unsignedContracts: unsigned, unreturned,
      bondsHeld: { count: bondsHeld._count, total: Number(bondsHeld._sum.bondAmount ?? 0) },
      outstanding: Number(unpaid._sum.total ?? 0) - Number(unpaid._sum.amountPaid ?? 0),
    };
  });

  // ---- Reporting ----
  const period = z.object({ start: z.coerce.date(), end: z.coerce.date() });

  app.get('/api/reports/revenue', async (req) => {
    const { start, end } = period.parse(req.query);
    const invoices = await prisma.invoice.findMany({ where: { createdAt: { gte: start, lt: end }, status: { not: 'CANCELLED' } }, select: { createdAt: true, subtotal: true, gstTotal: true, total: true, amountPaid: true, kind: true } });
    const byMonth = new Map<string, { month: string; subtotal: number; gst: number; total: number; paid: number }>();
    for (const i of invoices) {
      const m = i.createdAt.toISOString().slice(0, 7);
      const row = byMonth.get(m) ?? { month: m, subtotal: 0, gst: 0, total: 0, paid: 0 };
      const sign = i.kind === 'CREDIT' ? -1 : 1;
      row.subtotal += sign * Number(i.subtotal); row.gst += sign * Number(i.gstTotal); row.total += sign * Number(i.total); row.paid += Number(i.amountPaid);
      byMonth.set(m, row);
    }
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v])));
  });

  app.get('/api/reports/utilisation', async (req) => {
    const { start, end } = period.parse(req.query);
    const periodDays = hireDays(start, end);
    const [equipment, lines] = await Promise.all([
      prisma.equipment.findMany({ where: { archived: false }, select: { id: true, name: true, stockQuantity: true, serialised: true, _count: { select: { units: { where: { retired: false } } } } } }),
      prisma.bookingLineItem.findMany({ where: { booking: { loadIn: { lt: end }, loadOut: { gt: start }, status: { notIn: ['CANCELLED', 'ENQUIRY'] } } }, select: { equipmentId: true, qtyBooked: true, days: true, dailyRate: true } }),
    ]);
    return equipment.map((e) => {
      const stock = e.serialised ? e._count.units : e.stockQuantity;
      const ls = lines.filter((l) => l.equipmentId === e.id);
      const unitDays = ls.reduce((a, l) => a + l.qtyBooked * Number(l.days), 0);
      const revenue = ls.reduce((a, l) => a + l.qtyBooked * Number(l.days) * Number(l.dailyRate), 0);
      return { id: e.id, name: e.name, stock, bookings: ls.length, unitDays, utilisation: stock ? Math.min(1, unitDays / (stock * periodDays)) : 0, revenue: Math.round(revenue * 100) / 100 };
    }).sort((a, b) => b.utilisation - a.utilisation);
  });

  app.get('/api/reports/bonds', () => prisma.booking.findMany({
    where: { bondStatus: { in: ['HELD', 'PARTIALLY_FORFEITED', 'FULLY_FORFEITED'] } },
    select: { id: true, reference: true, title: true, loadOut: true, bondAmount: true, bondForfeited: true, bondStatus: true, client: { select: { name: true } } },
    orderBy: { loadOut: 'asc' },
  }));

  app.get('/api/calendar', async (req) => {
    const { start, end } = period.parse(req.query);
    const alloc = await allocations(start, end);
    return { overbooked: [...alloc.values()].filter((a) => a.available < 0).map((a) => ({ equipmentId: a.equipmentId, bookings: a.bookings.map((b) => b.id) })) };
  });
}
