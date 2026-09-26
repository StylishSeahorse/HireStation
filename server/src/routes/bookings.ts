import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/auth.js';
import { requireProfile, taxOf } from '../lib/profile.js';
import { conflictsFor } from '../lib/availability.js';
import { bookingInclude, bookingDays, nextReference, quoteTotals, usageTotals } from '../lib/bookings.js';

const STATUSES = ['ENQUIRY', 'QUOTED', 'CONFIRMED', 'CONTRACT_SENT', 'CONTRACT_VIEWED', 'CONTRACT_SIGNED', 'CONTRACT_DECLINED', 'INVOICED', 'PAID', 'COMPLETED', 'CANCELLED'] as const;
const money = z.coerce.number().min(0).multipleOf(0.01);

const bookingSchema = z.object({
  title: z.string().trim().min(1),
  clientId: z.string().min(1),
  venue: z.string().optional().nullable(),
  venueAddress: z.string().optional().nullable(),
  loadIn: z.coerce.date(),
  eventStart: z.coerce.date().optional().nullable(),
  eventEnd: z.coerce.date().optional().nullable(),
  loadOut: z.coerce.date(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().optional().nullable(),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  bondAmount: money.default(0),
  lineItems: z.array(z.object({
    equipmentId: z.string(),
    qtyBooked: z.coerce.number().int().min(1),
    dailyRate: money.optional(), // defaults to catalog rate
    days: z.coerce.number().positive().optional(), // defaults to booking hire days
  })).default([]),
  staff: z.array(z.object({
    staffId: z.string(), role: z.string().min(1),
    rate: money.optional().nullable(), hours: z.coerce.number().min(0).optional().nullable(),
  })).default([]),
}).refine((b) => b.loadOut > b.loadIn, { message: 'Load-out must be after load-in', path: ['loadOut'] })
  .refine((b) => !b.eventStart || !b.eventEnd || b.eventEnd >= b.eventStart, { message: 'Event end must be after start', path: ['eventEnd'] });

type BookingInput = z.infer<typeof bookingSchema>;

async function lineData(input: BookingInput) {
  const days = bookingDays(input);
  const eq = await prisma.equipment.findMany({ where: { id: { in: input.lineItems.map((l) => l.equipmentId) } }, select: { id: true, dailyRate: true } });
  const rates = new Map(eq.map((e) => [e.id, e.dailyRate]));
  return input.lineItems.map((l) => {
    if (!rates.has(l.equipmentId)) throw new HttpError(400, `Unknown equipment ${l.equipmentId}`);
    return { equipmentId: l.equipmentId, qtyBooked: l.qtyBooked, dailyRate: l.dailyRate ?? rates.get(l.equipmentId)!, days: l.days ?? days };
  });
}

async function withTotals(id: string) {
  const [b, profile] = await Promise.all([prisma.booking.findUnique({ where: { id }, include: bookingInclude }), requireProfile()]);
  if (!b) throw new HttpError(404, 'Booking not found');
  const tax = taxOf(profile);
  const conflicts = ['CANCELLED', 'COMPLETED'].includes(b.status) ? [] :
    await conflictsFor(b.loadIn, b.loadOut, b.lineItems.map((l) => ({ equipmentId: l.equipmentId, qty: l.qtyBooked })), b.id);
  return { ...b, quote: quoteTotals(b, tax), usage: b.returnInventory?.completed ? await usageTotals(b, tax) : null, conflicts, hireDays: bookingDays(b) };
}

export async function bookingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { start?: string; end?: string; status?: string; q?: string; clientId?: string } }>('/api/bookings', async (req) => {
    const { start, end, status, q, clientId } = req.query;
    const where: Prisma.BookingWhereInput = {
      ...(start && end ? { loadIn: { lt: new Date(end) }, loadOut: { gt: new Date(start) } } : {}),
      ...(status ? { status: { in: status.split(',') as (typeof STATUSES)[number][] } } : {}),
      ...(clientId ? { clientId } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { reference: { contains: q, mode: 'insensitive' } }, { venue: { contains: q, mode: 'insensitive' } }, { client: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
    };
    return prisma.booking.findMany({
      where, orderBy: { loadIn: 'asc' }, take: 500,
      include: { client: { select: { id: true, name: true } }, _count: { select: { lineItems: true, staff: true } } },
    });
  });

  app.get<{ Params: { id: string } }>('/api/bookings/:id', (req) => withTotals(req.params.id));

  // Pre-save conflict check used by the booking wizard.
  app.post('/api/bookings/check', async (req) => {
    const body = z.object({
      loadIn: z.coerce.date(), loadOut: z.coerce.date(), excludeBookingId: z.string().optional(),
      lineItems: z.array(z.object({ equipmentId: z.string(), qtyBooked: z.coerce.number().int() })),
    }).parse(req.body);
    return conflictsFor(body.loadIn, body.loadOut, body.lineItems.map((l) => ({ equipmentId: l.equipmentId, qty: l.qtyBooked })), body.excludeBookingId);
  });

  app.post('/api/bookings', async (req) => {
    const input = bookingSchema.parse(req.body);
    const lines = await lineData(input);
    const { lineItems: _l, staff, ...fields } = input;
    for (let attempt = 0; ; attempt++) {
      try {
        const b = await prisma.booking.create({
          data: {
            ...fields, reference: await nextReference(),
            bondStatus: input.bondAmount > 0 ? 'HELD' : 'NONE',
            lineItems: { create: lines },
            staff: { create: staff.map((s) => ({ staffId: s.staffId, role: s.role, rate: s.rate ?? null, hours: s.hours ?? null })) },
          },
        });
        return withTotals(b.id);
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002' && attempt < 5) continue; // reference race
        throw e;
      }
    }
  });

  app.put<{ Params: { id: string } }>('/api/bookings/:id', async (req) => {
    const input = bookingSchema.parse(req.body);
    const existing = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { departure: true } });
    if (!existing) throw new HttpError(404, 'Booking not found');
    const lines = await lineData(input);
    const { lineItems: _l, staff, ...fields } = input;
    await prisma.$transaction([
      prisma.bookingLineItem.deleteMany({ where: { bookingId: existing.id } }),
      prisma.bookingStaff.deleteMany({ where: { bookingId: existing.id } }),
      prisma.booking.update({
        where: { id: existing.id },
        data: {
          ...fields,
          bondStatus: existing.bondStatus === 'NONE' && input.bondAmount > 0 ? 'HELD' : existing.bondStatus,
          lineItems: { create: lines },
          staff: { create: staff.map((s) => ({ staffId: s.staffId, role: s.role, rate: s.rate ?? null, hours: s.hours ?? null })) },
        },
      }),
    ]);
    return withTotals(existing.id);
  });

  app.patch<{ Params: { id: string } }>('/api/bookings/:id/status', async (req) => {
    const { status } = z.object({ status: z.enum(STATUSES) }).parse(req.body);
    await prisma.booking.update({ where: { id: req.params.id }, data: { status } });
    return withTotals(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/bookings/:id/duplicate', async (req) => {
    const body = z.object({ loadIn: z.coerce.date(), title: z.string().optional() }).parse(req.body);
    const src = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { lineItems: true, staff: true } });
    if (!src) throw new HttpError(404, 'Booking not found');
    const shift = body.loadIn.getTime() - src.loadIn.getTime();
    const mv = (d: Date | null) => (d ? new Date(d.getTime() + shift) : null);
    const b = await prisma.booking.create({
      data: {
        reference: await nextReference(), title: body.title ?? src.title, clientId: src.clientId,
        venue: src.venue, venueAddress: src.venueAddress, notes: src.notes,
        loadIn: mv(src.loadIn)!, loadOut: mv(src.loadOut)!, eventStart: mv(src.eventStart), eventEnd: mv(src.eventEnd),
        discountPercent: src.discountPercent, bondAmount: src.bondAmount, bondStatus: Number(src.bondAmount) > 0 ? 'HELD' : 'NONE',
        duplicatedFromId: src.id,
        lineItems: { create: src.lineItems.map(({ equipmentId, qtyBooked, dailyRate, days }) => ({ equipmentId, qtyBooked, dailyRate, days })) },
        staff: { create: src.staff.map(({ staffId, role, rate, hours }) => ({ staffId, role, rate, hours })) },
      },
    });
    return withTotals(b.id);
  });

  app.delete<{ Params: { id: string } }>('/api/bookings/:id', async (req) => {
    const b = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { _count: { select: { invoices: true, contracts: true } } } });
    if (!b) throw new HttpError(404, 'Booking not found');
    if (b._count.invoices || b._count.contracts) throw new HttpError(409, 'Booking has contracts or invoices — cancel it instead');
    await prisma.booking.delete({ where: { id: b.id } });
    return { ok: true };
  });

  // ---- Bonds (held outside the GST invoice) ----
  app.patch<{ Params: { id: string } }>('/api/bookings/:id/bond', async (req) => {
    const body = z.object({
      bondStatus: z.enum(['NONE', 'HELD', 'REFUNDED', 'PARTIALLY_FORFEITED', 'FULLY_FORFEITED']),
      bondForfeited: money.default(0),
      bondNotes: z.string().optional().nullable(),
    }).parse(req.body);
    const b = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!b) throw new HttpError(404, 'Booking not found');
    const amount = Number(b.bondAmount);
    let forfeited = body.bondForfeited;
    if (body.bondStatus === 'FULLY_FORFEITED') forfeited = amount;
    if (['NONE', 'HELD', 'REFUNDED'].includes(body.bondStatus)) forfeited = 0;
    if (forfeited > amount) throw new HttpError(400, 'Forfeited amount cannot exceed the bond');
    if (body.bondStatus === 'PARTIALLY_FORFEITED' && (forfeited <= 0 || forfeited >= amount))
      throw new HttpError(400, 'A partial forfeit must be more than zero and less than the bond');
    await prisma.booking.update({
      where: { id: b.id },
      data: {
        bondStatus: body.bondStatus, bondForfeited: forfeited, bondNotes: body.bondNotes ?? b.bondNotes,
        bondRefundedAt: ['REFUNDED', 'PARTIALLY_FORFEITED'].includes(body.bondStatus) ? new Date() : null,
      },
    });
    return withTotals(b.id);
  });

  // Direct-deposit refund instructions merged from the business's bank settings.
  app.get<{ Params: { id: string } }>('/api/bookings/:id/bond/refund-instructions', async (req) => {
    const [b, p] = await Promise.all([prisma.booking.findUnique({ where: { id: req.params.id }, include: { client: true } }), requireProfile()]);
    if (!b) throw new HttpError(404, 'Booking not found');
    const refund = Number(b.bondAmount) - Number(b.bondForfeited);
    return {
      reference: b.reference, client: b.client.name,
      bondAmount: Number(b.bondAmount), forfeited: Number(b.bondForfeited), refundAmount: refund,
      business: { name: p.tradingName || p.legalName, bsb: p.bankBsb, accountNumber: p.bankAccountNumber, accountName: p.bankAccountName },
    };
  });
}
