import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/auth.js';
import { enqueue } from '../jobs/queue.js';
import { notify } from '../lib/bookings.js';

function keyMatches(expected: string | null, given: string) {
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

type DsPayload = {
  event_type?: string;
  data?: { id?: number; submission_id?: number; submission?: { id?: number }; documents?: { name: string; url: string }[]; decline_reason?: string };
};

export async function webhookRoutes(app: FastifyInstance) {
  app.post<{ Params: { key: string } }>('/api/webhooks/invoice-ninja/:key', async (req) => {
    const p = await prisma.businessProfile.findUnique({ where: { id: 1 } });
    if (!keyMatches(p?.invoiceNinjaWebhookKey ?? null, req.params.key)) throw new HttpError(404, 'Not found');
    const body = req.body as Record<string, unknown>;
    const evt = await prisma.webhookEvent.create({ data: { source: 'invoice-ninja', event: String(body?.entity_type ?? 'unknown'), payload: body as object } });
    // Process asynchronously; we re-fetch authoritative state from the API rather than trusting the payload.
    await enqueue('webhook.invoiceNinja', { eventId: evt.id });
    return { ok: true };
  });

  app.post<{ Params: { key: string } }>('/api/webhooks/docuseal/:key', async (req) => {
    const p = await prisma.businessProfile.findUnique({ where: { id: 1 } });
    if (!keyMatches(p?.docusealWebhookKey ?? null, req.params.key)) throw new HttpError(404, 'Not found');
    const body = req.body as DsPayload;
    const event = body?.event_type ?? 'unknown';
    const evt = await prisma.webhookEvent.create({ data: { source: 'docuseal', event, payload: body as object } });
    const submissionId = body.data?.submission_id ?? body.data?.submission?.id ?? (event.startsWith('submission.') ? body.data?.id : undefined);
    const contract = submissionId ? await prisma.contract.findFirst({ where: { docusealSubmissionId: String(submissionId) }, include: { booking: true } }) : null;
    if (!contract) {
      await prisma.webhookEvent.update({ where: { id: evt.id }, data: { processed: true, error: 'No matching contract' } });
      return { ok: true };
    }
    const now = new Date();
    if (event === 'form.viewed' || event === 'form.started') {
      if (contract.status === 'SENT') {
        await prisma.contract.update({ where: { id: contract.id }, data: { status: 'VIEWED', viewedAt: now } });
        if (contract.booking.status === 'CONTRACT_SENT') await prisma.booking.update({ where: { id: contract.bookingId }, data: { status: 'CONTRACT_VIEWED' } });
      }
    } else if (event === 'form.completed' || event === 'submission.completed') {
      await prisma.contract.update({ where: { id: contract.id }, data: { status: 'SIGNED', signedAt: now } });
      if (['CONTRACT_SENT', 'CONTRACT_VIEWED', 'CONFIRMED', 'QUOTED', 'ENQUIRY'].includes(contract.booking.status))
        await prisma.booking.update({ where: { id: contract.bookingId }, data: { status: 'CONTRACT_SIGNED' } });
      await notify('contract', `Contract signed for ${contract.booking.reference}`, contract.bookingId);
      await enqueue('contract.fetchSigned', { contractId: contract.id, documents: body.data?.documents ?? [] }, { jobId: `contract-signed-${contract.id}` });
    } else if (event === 'form.declined') {
      await prisma.contract.update({ where: { id: contract.id }, data: { status: 'DECLINED' } });
      await prisma.booking.update({ where: { id: contract.bookingId }, data: { status: 'CONTRACT_DECLINED' } });
      await notify('contract', `Contract DECLINED for ${contract.booking.reference}${body.data?.decline_reason ? `: ${body.data.decline_reason}` : ''}`, contract.bookingId);
    }
    await prisma.webhookEvent.update({ where: { id: evt.id }, data: { processed: true } });
    return { ok: true };
  });
}
