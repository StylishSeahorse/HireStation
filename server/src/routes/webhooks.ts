import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError, requireRole } from '../lib/auth.js';
import { enqueue } from '../jobs/queue.js';
import { audit } from '../lib/audit.js';

export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

function safeEqual(expected: string | null | undefined, given: string | undefined) {
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Neither Invoice Ninja nor Docuseal sign their webhooks, so two shared secrets are required:
 * an unguessable key in the URL path and a secret header configured on the sending side.
 */
async function verify(req: FastifyRequest<{ Params: { key: string } }>, which: 'invoiceNinjaWebhookKey' | 'docusealWebhookKey') {
  const p = await prisma.businessProfile.findUnique({ where: { id: 1 }, select: { [which]: true, webhookSecret: true } }) as Record<string, string | null> | null;
  const header = req.headers[WEBHOOK_SECRET_HEADER];
  if (!safeEqual(p?.[which], req.params.key) || !safeEqual(p?.webhookSecret, Array.isArray(header) ? header[0] : header)) {
    await audit(req, 'webhook.rejected', { user: null, detail: { source: which.replace('WebhookKey', ''), hasHeader: !!header } });
    throw new HttpError(404, 'Not found');
  }
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post<{ Params: { key: string } }>('/api/webhooks/invoice-ninja/:key', async (req) => {
    await verify(req, 'invoiceNinjaWebhookKey');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const evt = await prisma.webhookEvent.create({ data: { source: 'invoice-ninja', event: String(body.entity_type ?? 'unknown'), payload: body as object } });
    // Processed asynchronously; the worker re-fetches authoritative state from the API.
    await enqueue('webhook.process', { eventId: evt.id }, { jobId: `webhook-${evt.id}` });
    return { ok: true };
  });

  app.post<{ Params: { key: string } }>('/api/webhooks/docuseal/:key', async (req) => {
    await verify(req, 'docusealWebhookKey');
    const body = (req.body ?? {}) as { event_type?: string };
    const evt = await prisma.webhookEvent.create({ data: { source: 'docuseal', event: body.event_type ?? 'unknown', payload: body as object } });
    await enqueue('webhook.process', { eventId: evt.id }, { jobId: `webhook-${evt.id}` });
    return { ok: true };
  });

  // ---- Admin: inspect and replay received events ----
  app.get<{ Querystring: { status?: string; source?: string } }>('/api/webhook-events', async (req) => {
    requireRole(req, 'ADMIN');
    const { status, source } = req.query;
    return prisma.webhookEvent.findMany({
      where: {
        ...(source ? { source } : {}),
        ...(status === 'failed' ? { processed: false, error: { not: null } } : status === 'pending' ? { processed: false } : status === 'processed' ? { processed: true } : {}),
      },
      orderBy: { receivedAt: 'desc' }, take: 200,
    });
  });

  app.post<{ Params: { id: string } }>('/api/webhook-events/:id/replay', async (req) => {
    requireRole(req, 'ADMIN');
    const evt = await prisma.webhookEvent.update({ where: { id: req.params.id }, data: { processed: false, error: null } });
    await enqueue('webhook.process', { eventId: evt.id }, { jobId: `webhook-${evt.id}-replay-${Date.now()}` });
    return { queued: true };
  });

  app.post('/api/webhook-events/replay-failed', async (req) => {
    requireRole(req, 'ADMIN');
    const { olderThanMinutes } = z.object({ olderThanMinutes: z.number().min(0).default(0) }).parse(req.body ?? {});
    const failed = await prisma.webhookEvent.findMany({ where: { processed: false, receivedAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) } }, select: { id: true } });
    for (const e of failed) await enqueue('webhook.process', { eventId: e.id }, { jobId: `webhook-${e.id}-replay-${Date.now()}` });
    return { queued: failed.length };
  });
}
