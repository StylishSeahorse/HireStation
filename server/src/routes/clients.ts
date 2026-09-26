import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/auth.js';
import { isValidAbn, normaliseDigits } from '../lib/au.js';

const clientSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'BUSINESS']),
  name: z.string().trim().min(1),
  contactName: z.string().trim().optional().nullable(),
  email: z.union([z.email(), z.literal('')]).optional().nullable().transform((v) => v || null),
  phone: z.string().trim().optional().nullable(),
  abn: z.string().optional().nullable()
    .refine((v) => !v || isValidAbn(v), 'Invalid ABN (checksum failed)')
    .transform((v) => (v ? normaliseDigits(v) : null)),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function clientRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>('/api/clients', async (req) => {
    const q = req.query.q;
    return prisma.client.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { contactName: { contains: q, mode: 'insensitive' } }, { abn: { contains: normaliseDigits(q) || q } }] } : {},
      include: { _count: { select: { bookings: true } } },
      orderBy: { name: 'asc' },
    });
  });

  app.get<{ Params: { id: string } }>('/api/clients/:id', async (req) => {
    const c = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { bookings: { orderBy: { loadIn: 'desc' }, select: { id: true, reference: true, title: true, loadIn: true, loadOut: true, status: true, venue: true, bondStatus: true } } },
    });
    if (!c) throw new HttpError(404, 'Client not found');
    return c;
  });

  app.post('/api/clients', async (req) => prisma.client.create({ data: clientSchema.parse(req.body) }));

  app.put<{ Params: { id: string } }>('/api/clients/:id', async (req) =>
    prisma.client.update({ where: { id: req.params.id }, data: clientSchema.parse(req.body) }));

  app.delete<{ Params: { id: string } }>('/api/clients/:id', async (req) => {
    if (await prisma.booking.count({ where: { clientId: req.params.id } })) throw new HttpError(409, 'Client has bookings and cannot be deleted');
    await prisma.client.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
}
