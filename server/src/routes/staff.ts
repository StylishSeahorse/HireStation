import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError, requireRole } from '../lib/auth.js';

const staffSchema = z.object({
  name: z.string().trim().min(1),
  email: z.union([z.email(), z.literal('')]).optional().nullable().transform((v) => v || null),
  phone: z.string().optional().nullable(),
  skills: z.array(z.string()).default([]),
  userId: z.string().optional().nullable().transform((v) => v || null),
  active: z.boolean().default(true),
});

const upcoming = (staffId: string) => prisma.bookingStaff.findMany({
  where: { staffId, booking: { loadOut: { gte: new Date() }, status: { not: 'CANCELLED' } } },
  include: { booking: { select: { id: true, reference: true, title: true, venue: true, loadIn: true, loadOut: true, status: true } } },
  orderBy: { booking: { loadIn: 'asc' } },
});

export async function staffRoutes(app: FastifyInstance) {
  app.get('/api/staff', () => prisma.staff.findMany({ orderBy: { name: 'asc' }, include: { user: { select: { id: true, email: true } } } }));

  app.get<{ Params: { id: string } }>('/api/staff/:id', async (req) => {
    const s = await prisma.staff.findUnique({ where: { id: req.params.id } });
    if (!s) throw new HttpError(404, 'Staff member not found');
    return { ...s, schedule: await upcoming(s.id) };
  });

  // "My schedule" for the signed-in user when linked to a staff record.
  app.get('/api/me/schedule', async (req) => {
    const s = await prisma.staff.findUnique({ where: { userId: req.user!.id } });
    return s ? upcoming(s.id) : [];
  });

  app.post('/api/staff', async (req) => { requireRole(req, 'ADMIN'); return prisma.staff.create({ data: staffSchema.parse(req.body) }); });
  app.put<{ Params: { id: string } }>('/api/staff/:id', async (req) => {
    requireRole(req, 'ADMIN');
    return prisma.staff.update({ where: { id: req.params.id }, data: staffSchema.parse(req.body) });
  });
  app.delete<{ Params: { id: string } }>('/api/staff/:id', async (req) => {
    requireRole(req, 'ADMIN');
    if (await prisma.bookingStaff.count({ where: { staffId: req.params.id } })) {
      await prisma.staff.update({ where: { id: req.params.id }, data: { active: false } });
      return { deactivated: true };
    }
    await prisma.staff.delete({ where: { id: req.params.id } });
    return { deleted: true };
  });
}
