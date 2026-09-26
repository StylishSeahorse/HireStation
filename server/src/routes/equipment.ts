import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/auth.js';
import { allocations } from '../lib/availability.js';
import { saveFile, fileExists, openFile, mimeOf, removeFile } from '../lib/storage.js';

const money = z.coerce.number().min(0).multipleOf(0.01);

const equipmentSchema = z.object({
  name: z.string().trim().min(1),
  sku: z.string().trim().optional().nullable().transform((v) => v || null),
  description: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable().transform((v) => v || null),
  tags: z.array(z.string().trim().min(1)).default([]),
  dailyRate: money,
  replacementValue: money.optional().nullable(),
  gstTaxable: z.boolean().default(true),
  stockQuantity: z.coerce.number().int().min(0).default(0),
  serialised: z.boolean().default(false),
  archived: z.boolean().optional(),
});

const unitSchema = z.object({
  serialNumber: z.string().trim().min(1),
  condition: z.enum(['GOOD', 'FAIR', 'DAMAGED', 'IN_REPAIR']).default('GOOD'),
  conditionNotes: z.string().optional().nullable(),
  retired: z.boolean().optional(),
});

const range = z.object({ start: z.coerce.date(), end: z.coerce.date() }).refine((r) => r.end > r.start, 'End must be after start');

export async function equipmentRoutes(app: FastifyInstance) {
  // ---- Categories ----
  app.get('/api/categories', () => prisma.category.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { equipment: true } } } }));
  app.post('/api/categories', async (req) => {
    const body = z.object({ name: z.string().trim().min(1), parentId: z.string().optional().nullable() }).parse(req.body);
    return prisma.category.create({ data: body });
  });
  app.patch<{ Params: { id: string } }>('/api/categories/:id', async (req) => {
    const body = z.object({ name: z.string().trim().min(1).optional(), parentId: z.string().nullable().optional() }).parse(req.body);
    if (body.parentId === req.params.id) throw new HttpError(400, 'A category cannot be its own parent');
    return prisma.category.update({ where: { id: req.params.id }, data: body });
  });
  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (req) => {
    const c = await prisma.category.findUnique({ where: { id: req.params.id }, include: { _count: { select: { equipment: true, children: true } } } });
    if (!c) throw new HttpError(404, 'Not found');
    if (c._count.equipment || c._count.children) throw new HttpError(409, 'Category is in use');
    await prisma.category.delete({ where: { id: c.id } });
    return { ok: true };
  });

  // ---- Equipment ----
  app.get<{ Querystring: { q?: string; categoryId?: string; archived?: string } }>('/api/equipment', async (req) => {
    const { q, categoryId, archived } = req.query;
    return prisma.equipment.findMany({
      where: {
        archived: archived === 'true',
        ...(categoryId ? { categoryId } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { tags: { has: q.toLowerCase() } }] } : {}),
      },
      include: { category: true, _count: { select: { units: { where: { retired: false } } } } },
      orderBy: { name: 'asc' },
    });
  });

  app.get<{ Params: { id: string } }>('/api/equipment/:id', async (req) => {
    const e = await prisma.equipment.findUnique({ where: { id: req.params.id }, include: { category: true, units: { orderBy: { serialNumber: 'asc' } } } });
    if (!e) throw new HttpError(404, 'Equipment not found');
    const upcoming = await prisma.bookingLineItem.findMany({
      where: { equipmentId: e.id, booking: { loadOut: { gte: new Date() }, status: { not: 'CANCELLED' } } },
      include: { booking: { select: { id: true, reference: true, title: true, loadIn: true, loadOut: true, status: true } } },
      orderBy: { booking: { loadIn: 'asc' } }, take: 20,
    });
    return { ...e, upcoming };
  });

  app.post('/api/equipment', async (req) => {
    const body = equipmentSchema.parse(req.body);
    return prisma.equipment.create({ data: { ...body, tags: body.tags.map((t) => t.toLowerCase()) } });
  });

  app.put<{ Params: { id: string } }>('/api/equipment/:id', async (req) => {
    const body = equipmentSchema.parse(req.body);
    return prisma.equipment.update({ where: { id: req.params.id }, data: { ...body, tags: body.tags.map((t) => t.toLowerCase()) } });
  });

  app.delete<{ Params: { id: string } }>('/api/equipment/:id', async (req) => {
    // Equipment referenced by bookings is archived, not deleted, to keep history intact.
    const used = await prisma.bookingLineItem.count({ where: { equipmentId: req.params.id } });
    if (used) {
      await prisma.equipment.update({ where: { id: req.params.id }, data: { archived: true } });
      return { archived: true };
    }
    const e = await prisma.equipment.delete({ where: { id: req.params.id } });
    await Promise.all(e.photos.map(removeFile));
    return { deleted: true };
  });

  // ---- Photos ----
  app.post<{ Params: { id: string } }>('/api/equipment/:id/photos', async (req) => {
    const e = await prisma.equipment.findUnique({ where: { id: req.params.id } });
    if (!e) throw new HttpError(404, 'Equipment not found');
    const added: string[] = [];
    for await (const file of req.files()) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.mimetype)) throw new HttpError(400, 'Photos must be PNG, JPEG or WebP');
      added.push(await saveFile('equipment', file.filename, await file.toBuffer()));
    }
    return prisma.equipment.update({ where: { id: e.id }, data: { photos: [...e.photos, ...added] } });
  });

  app.delete<{ Params: { id: string; idx: string } }>('/api/equipment/:id/photos/:idx', async (req) => {
    const e = await prisma.equipment.findUnique({ where: { id: req.params.id } });
    if (!e) throw new HttpError(404, 'Equipment not found');
    const idx = Number(req.params.idx);
    const photo = e.photos[idx];
    if (!photo) throw new HttpError(404, 'Photo not found');
    await removeFile(photo);
    return prisma.equipment.update({ where: { id: e.id }, data: { photos: e.photos.filter((_, i) => i !== idx) } });
  });

  app.get<{ Params: { id: string; idx: string } }>('/api/equipment/:id/photos/:idx', async (req, reply) => {
    const e = await prisma.equipment.findUnique({ where: { id: req.params.id }, select: { photos: true } });
    const photo = e?.photos[Number(req.params.idx)];
    if (!photo || !fileExists(photo)) throw new HttpError(404, 'Photo not found');
    reply.header('Content-Type', mimeOf(photo)).header('Cache-Control', 'private, max-age=86400');
    return reply.send(openFile(photo));
  });

  // ---- Units ----
  app.post<{ Params: { id: string } }>('/api/equipment/:id/units', async (req) => {
    const body = unitSchema.parse(req.body);
    return prisma.equipmentUnit.create({ data: { ...body, equipmentId: req.params.id } });
  });
  app.patch<{ Params: { unitId: string } }>('/api/units/:unitId', async (req) => {
    const body = unitSchema.partial().parse(req.body);
    return prisma.equipmentUnit.update({ where: { id: req.params.unitId }, data: body });
  });
  app.delete<{ Params: { unitId: string } }>('/api/units/:unitId', async (req) => {
    await prisma.equipmentUnit.delete({ where: { id: req.params.unitId } });
    return { ok: true };
  });

  // ---- Availability ----
  app.get<{ Querystring: { start: string; end: string; excludeBookingId?: string } }>('/api/availability', async (req) => {
    const { start, end } = range.parse(req.query);
    const alloc = await allocations(start, end, { excludeBookingId: req.query.excludeBookingId });
    return [...alloc.values()];
  });
}
