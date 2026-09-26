import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/auth.js';
import { enqueue } from '../jobs/queue.js';

const money = z.coerce.number().min(0).multipleOf(0.01);

const departureSchema = z.object({
  notes: z.string().optional().nullable(),
  lines: z.array(z.object({
    equipmentId: z.string(),
    qtyOut: z.coerce.number().int().min(0),
    unitIds: z.array(z.string()).default([]),
    dailyRate: money.optional(),
    days: z.coerce.number().positive().optional(),
  })),
});

const returnSchema = z.object({
  notes: z.string().optional().nullable(),
  returnedAt: z.coerce.date().optional().nullable(),
  lateFee: money.default(0),
  lines: z.array(z.object({
    equipmentId: z.string(),
    qtyReturned: z.coerce.number().int().min(0),
    condition: z.enum(['GOOD', 'FAIR', 'DAMAGED', 'LOST']).default('GOOD'),
    damageNotes: z.string().optional().nullable(),
    damageCharge: money.default(0),
  })),
});

async function booking(id: string) {
  const b = await prisma.booking.findUnique({
    where: { id },
    include: { lineItems: true, departure: { include: { lines: true } }, returnInventory: { include: { lines: true } } },
  });
  if (!b) throw new HttpError(404, 'Booking not found');
  return b;
}

export async function inventoryRoutes(app: FastifyInstance) {
  // Departure: pre-filled from the booked list, editable to reflect what actually left.
  app.get<{ Params: { id: string } }>('/api/bookings/:id/departure', async (req) => {
    const b = await booking(req.params.id);
    if (b.departure) return b.departure;
    return {
      bookingId: b.id, completed: false, notes: null, draft: true,
      lines: b.lineItems.map((l) => ({ equipmentId: l.equipmentId, qtyOut: l.qtyBooked, unitIds: [], dailyRate: l.dailyRate, days: l.days })),
    };
  });

  app.put<{ Params: { id: string }; Querystring: { complete?: string } }>('/api/bookings/:id/departure', async (req) => {
    const body = departureSchema.parse(req.body);
    const b = await booking(req.params.id);
    if (b.returnInventory?.completed) throw new HttpError(409, 'Return is already completed');
    const booked = new Map(b.lineItems.map((l) => [l.equipmentId, l]));
    const extra = body.lines.filter((l) => !booked.has(l.equipmentId)).map((l) => l.equipmentId);
    const catalog = new Map((await prisma.equipment.findMany({ where: { id: { in: extra } }, select: { id: true, dailyRate: true } })).map((e) => [e.id, e.dailyRate]));
    const days = b.lineItems[0]?.days;
    const lines = body.lines.map((l) => {
      const bl = booked.get(l.equipmentId);
      const rate = l.dailyRate ?? bl?.dailyRate ?? catalog.get(l.equipmentId);
      if (rate === undefined) throw new HttpError(400, `Unknown equipment ${l.equipmentId}`);
      return { equipmentId: l.equipmentId, qtyOut: l.qtyOut, unitIds: l.unitIds, dailyRate: rate, days: l.days ?? bl?.days ?? days ?? 1 };
    });
    const complete = req.query.complete === 'true';
    const data = { notes: body.notes ?? null, completed: complete, completedAt: complete ? new Date() : null, completedBy: complete ? req.user!.name : null };
    await prisma.$transaction(async (tx) => {
      const dep = await tx.departureInventory.upsert({ where: { bookingId: b.id }, create: { bookingId: b.id, ...data }, update: data });
      await tx.departureLine.deleteMany({ where: { departureId: dep.id } });
      await tx.departureLine.createMany({ data: lines.map((l) => ({ ...l, departureId: dep.id })) });
    });
    return (await booking(b.id)).departure;
  });

  // Return: pre-filled from the departure record; completion triggers invoicing.
  app.get<{ Params: { id: string } }>('/api/bookings/:id/return', async (req) => {
    const b = await booking(req.params.id);
    if (b.returnInventory) return b.returnInventory;
    if (!b.departure?.completed) throw new HttpError(409, 'Complete the departure checklist first');
    return {
      bookingId: b.id, completed: false, notes: null, returnedAt: null, lateFee: 0, draft: true,
      lines: b.departure.lines.map((l) => ({ equipmentId: l.equipmentId, qtyOut: l.qtyOut, qtyReturned: l.qtyOut, condition: 'GOOD', damageNotes: null, damageCharge: 0 })),
    };
  });

  app.put<{ Params: { id: string }; Querystring: { complete?: string } }>('/api/bookings/:id/return', async (req) => {
    const body = returnSchema.parse(req.body);
    const b = await booking(req.params.id);
    if (!b.departure?.completed) throw new HttpError(409, 'Complete the departure checklist first');
    if (b.returnInventory?.completed) throw new HttpError(409, 'Return already completed — use invoice adjustment for changes');
    const out = new Map(b.departure.lines.map((l) => [l.equipmentId, l]));
    const lines = body.lines.map((l) => {
      const d = out.get(l.equipmentId);
      if (!d) throw new HttpError(400, 'Returned item was not on the departure record');
      if (l.qtyReturned > d.qtyOut) throw new HttpError(400, 'Cannot return more than went out');
      return { ...l, qtyOut: d.qtyOut, dailyRate: d.dailyRate, days: d.days, condition: l.qtyReturned < d.qtyOut && l.condition === 'GOOD' ? 'LOST' : l.condition };
    });
    for (const d of b.departure.lines) if (!lines.some((l) => l.equipmentId === d.equipmentId))
      throw new HttpError(400, 'Every departed item must be accounted for on return');
    const complete = req.query.complete === 'true';
    const returnedAt = body.returnedAt ?? (complete ? new Date() : null);
    const data = {
      notes: body.notes ?? null, lateFee: body.lateFee, returnedAt,
      lateReturn: !!returnedAt && returnedAt > b.loadOut,
      completed: complete, completedAt: complete ? new Date() : null, completedBy: complete ? req.user!.name : null,
    };
    await prisma.$transaction(async (tx) => {
      const r = await tx.returnInventory.upsert({ where: { bookingId: b.id }, create: { bookingId: b.id, ...data }, update: data });
      await tx.returnLine.deleteMany({ where: { returnId: r.id } });
      await tx.returnLine.createMany({ data: lines.map((l) => ({ ...l, returnId: r.id })) });
      // Flag damaged serialised units that went out on this booking for follow-up.
      for (const l of lines) {
        const unitIds = out.get(l.equipmentId)?.unitIds ?? [];
        if (complete && l.condition === 'DAMAGED' && unitIds.length)
          await tx.equipmentUnit.updateMany({ where: { id: { in: unitIds } }, data: { conditionNotes: `Reported damaged on ${b.reference}: ${l.damageNotes ?? ''}`.trim() } });
      }
    });
    if (complete) await enqueue('invoice.generate', { bookingId: b.id });
    return (await booking(b.id)).returnInventory;
  });
}
