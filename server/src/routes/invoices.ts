import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { generateInvoice, syncInvoice } from '../services/invoicing.js';
import { HttpError } from '../lib/auth.js';

export async function invoiceRoutes(app: FastifyInstance) {
  app.get('/api/invoices', () => prisma.invoice.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { booking: { select: { id: true, reference: true, title: true, client: { select: { name: true } } } } } }));

  // Manual generate / regenerate. `adjust` allows a follow-up invoice or credit note once the original was sent.
  app.post<{ Params: { id: string } }>('/api/bookings/:id/invoice', async (req) => {
    const { adjust } = z.object({ adjust: z.boolean().default(false) }).parse(req.body ?? {});
    return generateInvoice(req.params.id, { adjust });
  });

  app.post<{ Params: { id: string } }>('/api/invoices/:id/sync', async (req) => {
    const inv = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!inv?.invoiceNinjaInvoiceId) throw new HttpError(404, 'Invoice not found');
    return { status: await syncInvoice(inv.invoiceNinjaInvoiceId) };
  });
}
