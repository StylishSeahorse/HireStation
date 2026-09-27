import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError, requireRole } from '../lib/auth.js';
import { MERGE_FIELDS } from '../lib/merge.js';
import { bookingInclude } from '../lib/bookings.js';
import { assertFits, assertSendable, contractHtml, createContract, renderPreview } from '../services/contracts.js';
import { docusealClient } from '../lib/profile.js';
import { enqueue } from '../jobs/queue.js';
import { fileExists, openFile } from '../lib/storage.js';

const clauseSchema = z.object({ title: z.string().trim().min(1), category: z.string().optional().nullable(), content: z.string() });
const templateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  content: z.string().optional(),
  docusealTemplateId: z.string().optional().nullable().transform((v) => v || null),
  archived: z.boolean().optional(),
  equipmentRows: z.coerce.number().int().min(1).max(10).optional().nullable(),
  equipmentOverflow: z.boolean().optional(),
});

const html = (reply: { header: (k: string, v: string) => unknown }) => {
  reply.header('Content-Type', 'text/html; charset=utf-8');
  // Rendered in a sandboxed iframe; no scripts needed.
  reply.header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'");
};

export async function contractRoutes(app: FastifyInstance) {
  app.get('/api/contract-fields', () => MERGE_FIELDS);

  // ---- Clause library ----
  app.get('/api/clauses', () => prisma.clause.findMany({ orderBy: [{ category: 'asc' }, { title: 'asc' }] }));
  app.post('/api/clauses', (req) => prisma.clause.create({ data: clauseSchema.parse(req.body) }));
  app.put<{ Params: { id: string } }>('/api/clauses/:id', (req) => prisma.clause.update({ where: { id: req.params.id }, data: clauseSchema.parse(req.body) }));
  app.delete<{ Params: { id: string } }>('/api/clauses/:id', async (req) => { await prisma.clause.delete({ where: { id: req.params.id } }); return { ok: true }; });

  // ---- Templates (versioned) ----
  app.get('/api/templates', async () => {
    const ts = await prisma.contractTemplate.findMany({ orderBy: { name: 'asc' }, include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, createdAt: true } } } });
    return ts.map(({ versions, ...t }) => ({ ...t, latestVersion: versions[0]?.version ?? 0, updatedAt: versions[0]?.createdAt ?? t.updatedAt }));
  });

  app.get<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
    const t = await prisma.contractTemplate.findUnique({ where: { id: req.params.id }, include: { versions: { orderBy: { version: 'desc' }, select: { id: true, version: true, createdAt: true, content: true, _count: { select: { contracts: true } } } } } });
    if (!t) throw new HttpError(404, 'Template not found');
    return { ...t, content: t.versions[0]?.content ?? '' };
  });

  app.post('/api/templates', async (req) => {
    const { content, ...body } = templateSchema.parse(req.body);
    return prisma.contractTemplate.create({ data: { ...body, versions: { create: { version: 1, content: content ?? '' } } } });
  });

  // Saving new content creates a new version; older versions stay untouched for contracts already issued.
  app.put<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
    const { content, ...body } = templateSchema.parse(req.body);
    const t = await prisma.contractTemplate.findUnique({ where: { id: req.params.id }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!t) throw new HttpError(404, 'Template not found');
    const latest = t.versions[0];
    await prisma.contractTemplate.update({ where: { id: t.id }, data: body });
    if (content !== undefined && content !== latest?.content)
      await prisma.contractTemplateVersion.create({ data: { templateId: t.id, version: (latest?.version ?? 0) + 1, content } });
    return prisma.contractTemplate.findUnique({ where: { id: t.id } });
  });

  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
    const used = await prisma.contract.count({ where: { templateVersion: { templateId: req.params.id } } });
    if (used) { await prisma.contractTemplate.update({ where: { id: req.params.id }, data: { archived: true } }); return { archived: true }; }
    await prisma.contractTemplate.delete({ where: { id: req.params.id } });
    return { deleted: true };
  });

  app.post('/api/templates/preview', async (req, reply) => {
    const body = z.object({ content: z.string(), bookingId: z.string().optional() }).parse(req.body);
    html(reply);
    return renderPreview(body.content, body.bookingId);
  });

  app.get('/api/docuseal/templates', async (req) => {
    requireRole(req, 'ADMIN');
    const { client } = await docusealClient();
    return client.listTemplates();
  });

  // ---- Contracts for bookings ----
  app.post<{ Params: { id: string } }>('/api/bookings/:id/contracts', async (req) => {
    const { templateId, send } = z.object({ templateId: z.string(), send: z.boolean().default(false) }).parse(req.body);
    const b = await prisma.booking.findUnique({ where: { id: req.params.id }, include: bookingInclude });
    if (!b) throw new HttpError(404, 'Booking not found');
    if (send) {
      // Fail in the request (not later in the worker) when this template can't be sent.
      const { profile } = await docusealClient();
      const t = await prisma.contractTemplate.findUnique({ where: { id: templateId } });
      assertSendable(profile, t?.docusealTemplateId ?? null);
      await assertFits(b.id, templateId);
    }
    const c = await createContract(b, templateId);
    if (send) await enqueue('contract.send', { contractId: c.id }, { jobId: `contract-send-${c.id}` });
    return c;
  });

  app.get<{ Params: { id: string } }>('/api/contracts/:id/html', async (req, reply) => {
    html(reply);
    return contractHtml(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/contracts/:id/send', async (req) => {
    const c = await prisma.contract.findUnique({ where: { id: req.params.id }, include: { templateVersion: { include: { template: true } } } });
    if (!c) throw new HttpError(404, 'Contract not found');
    if (c.status !== 'DRAFT') throw new HttpError(409, 'Contract has already been sent');
    const { profile } = await docusealClient(); // fail fast if not configured
    assertSendable(profile, c.templateVersion.template.docusealTemplateId);
    await assertFits(c.bookingId, c.templateVersion.templateId);
    await enqueue('contract.send', { contractId: c.id }, { jobId: `contract-send-${c.id}` });
    return { queued: true };
  });

  app.post<{ Params: { id: string } }>('/api/contracts/:id/void', async (req) =>
    prisma.contract.update({ where: { id: req.params.id }, data: { status: 'VOID' } }));

  app.get<{ Params: { id: string } }>('/api/contracts/:id/signed', async (req, reply) => {
    const c = await prisma.contract.findUnique({ where: { id: req.params.id }, include: { booking: true } });
    if (!c?.signedPdfPath || !fileExists(c.signedPdfPath)) throw new HttpError(404, 'Signed PDF not available yet');
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${c.booking.reference}-signed.pdf"`);
    return reply.send(openFile(c.signedPdfPath));
  });
}
