import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
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

const SIGNATURE_TOLERANCE_S = 5 * 60;

/**
 * Docuseal's X-Docuseal-Signature: "<unix ts>.<hex HMAC-SHA256(secret, `${ts}.${rawBody}`)>".
 * Rejects signatures more than 5 minutes old (replay protection), matching Docuseal's own verifier.
 */
export function verifyDocusealSignature(secret: string, rawBody: string, header: string | undefined, now = Date.now()): boolean {
  const [tsText, sig] = (header ?? '').split('.', 2);
  const ts = Number(tsText);
  if (!Number.isInteger(ts) || !sig) return false;
  if (Math.abs(now / 1000 - ts) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return safeEqual(expected, sig);
}

const first = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h);

/**
 * Every webhook needs the unguessable key in its URL, plus proof it came from the integration:
 * - Invoice Ninja (unsigned): the shared X-Webhook-Secret header.
 * - Docuseal: a valid HMAC X-Docuseal-Signature (when its signing secret is saved in Settings),
 *   or the shared X-Webhook-Secret header.
 */
async function verify(req: FastifyRequest<{ Params: { key: string } }>, which: 'invoiceNinjaWebhookKey' | 'docusealWebhookKey') {
  const p = await prisma.businessProfile.findUnique({
    where: { id: 1 }, select: { invoiceNinjaWebhookKey: true, docusealWebhookKey: true, webhookSecret: true, docusealWebhookHmacSecret: true },
  });
  const header = first(req.headers[WEBHOOK_SECRET_HEADER]);
  const signature = first(req.headers['x-docuseal-signature']);
  const keyOk = safeEqual(p?.[which], req.params.key);
  const headerOk = safeEqual(p?.webhookSecret, header);
  const hmacOk = which === 'docusealWebhookKey' && !!p?.docusealWebhookHmacSecret &&
    verifyDocusealSignature(p.docusealWebhookHmacSecret, req.rawBody ?? '', signature);
  if (!keyOk || !(headerOk || hmacOk)) {
    await audit(req, 'webhook.rejected', { user: null, detail: { source: which.replace('WebhookKey', ''), keyOk, hasHeader: !!header, hasSignature: !!signature } });
    throw new HttpError(404, 'Not found');
  }
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post<{ Params: { key: string } }>('/api/webhooks/invoice-ninja/:key', async (req) => {
    await verify(req, 'invoiceNinjaWebhookKey');
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Invoice payloads carry entity_type; payment payloads don't, but list their invoices/paymentables.
    const kind = body.entity_type ?? (Array.isArray(body.paymentables) || (Array.isArray(body.invoices) && !Array.isArray(body.line_items)) ? 'payment' : 'unknown');
    const evt = await prisma.webhookEvent.create({ data: { source: 'invoice-ninja', event: String(kind), payload: body as object } });
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
