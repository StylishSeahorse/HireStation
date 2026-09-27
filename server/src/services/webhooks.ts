import { prisma } from '../lib/db.js';
import { notify } from '../lib/bookings.js';
import { invoiceNinjaClient } from '../lib/profile.js';
import { enqueue } from '../jobs/queue.js';
import { syncInvoice } from './invoicing.js';
import { syncInClientById } from './clientSync.js';

type DsPayload = {
  event_type?: string;
  data?: { id?: number; submission_id?: number; submission?: { id?: number }; documents?: { name: string; url: string }[]; decline_reason?: string };
};

type InPayload = {
  id?: string; entity_type?: string; invoice_id?: string; client_id?: string; line_items?: unknown[]; contacts?: unknown[]; vat_number?: string;
  invoices?: { invoice_id?: string; id?: string }[]; paymentables?: { invoice_id?: string }[];
};

/** Client payloads: entity_type 'client', or client-shaped (contacts, no line items, not linked to a client). */
export const isInClientPayload = (p: InPayload) =>
  p.entity_type === 'client' || (!p.entity_type && Array.isArray(p.contacts) && !Array.isArray(p.line_items) && !p.client_id && 'vat_number' in p);

/** Run a stored webhook event, recording attempts and the last error so failures can be replayed from Settings. */
export async function runWebhookEvent(eventId: string) {
  const evt = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!evt || evt.processed) return;
  await prisma.webhookEvent.update({ where: { id: evt.id }, data: { attempts: { increment: 1 } } });
  try {
    const note = evt.source === 'docuseal' ? await docuseal(evt.payload as DsPayload) : await invoiceNinja(evt.payload as InPayload);
    await prisma.webhookEvent.update({ where: { id: evt.id }, data: { processed: true, processedAt: new Date(), error: note ?? null } });
  } catch (e) {
    await prisma.webhookEvent.update({ where: { id: evt.id }, data: { error: (e as Error).message.slice(0, 1000) } });
    throw e; // let the queue retry with backoff
  }
}

/** Returns a note when the event was valid but didn't apply to anything here. */
async function docuseal(body: DsPayload): Promise<string | void> {
  const event = body.event_type ?? 'unknown';
  const submissionId = body.data?.submission_id ?? body.data?.submission?.id ?? (event.startsWith('submission.') ? body.data?.id : undefined);
  const contract = submissionId ? await prisma.contract.findFirst({ where: { docusealSubmissionId: String(submissionId) }, include: { booking: true } }) : null;
  if (!contract) return 'No matching contract';
  const now = new Date();
  if (event === 'form.viewed' || event === 'form.started') {
    if (contract.status === 'SENT') {
      await prisma.contract.update({ where: { id: contract.id }, data: { status: 'VIEWED', viewedAt: now } });
      if (contract.booking.status === 'CONTRACT_SENT') await prisma.booking.update({ where: { id: contract.bookingId }, data: { status: 'CONTRACT_VIEWED' } });
    }
  } else if (event === 'form.completed' || event === 'submission.completed') {
    if (contract.status !== 'SIGNED') {
      await prisma.contract.update({ where: { id: contract.id }, data: { status: 'SIGNED', signedAt: now } });
      if (['CONTRACT_SENT', 'CONTRACT_VIEWED', 'CONFIRMED', 'QUOTED', 'ENQUIRY'].includes(contract.booking.status))
        await prisma.booking.update({ where: { id: contract.bookingId }, data: { status: 'CONTRACT_SIGNED' } });
      await notify('contract', `Contract signed for ${contract.booking.reference}`, contract.bookingId);
    }
    await enqueue('contract.fetchSigned', { contractId: contract.id, documents: body.data?.documents ?? [] }, { jobId: `contract-signed-${contract.id}` });
  } else if (event === 'form.declined') {
    await prisma.contract.update({ where: { id: contract.id }, data: { status: 'DECLINED' } });
    await prisma.booking.update({ where: { id: contract.bookingId }, data: { status: 'CONTRACT_DECLINED' } });
    await notify('contract', `Contract DECLINED for ${contract.booking.reference}${body.data?.decline_reason ? `: ${body.data.decline_reason}` : ''}`, contract.bookingId);
  } else {
    return `Ignored event ${event}`;
  }
}

async function invoiceNinja(payload: InPayload): Promise<string | void> {
  if (isInClientPayload(payload)) return payload.id ? syncInClientById(payload.id) : 'Client event without an id';
  const ids = new Set<string>();
  const isPayment = payload.entity_type === 'payment' || !!payload.paymentables || (Array.isArray(payload.invoices) && !payload.invoice_id);
  if (isPayment) {
    for (const i of payload.invoices ?? []) if (i.invoice_id || i.id) ids.add((i.invoice_id ?? i.id)!);
    for (const i of payload.paymentables ?? []) if (i.invoice_id) ids.add(i.invoice_id);
    if (!ids.size && payload.id) {
      const { client } = await invoiceNinjaClient();
      const pay = (await client.getPayment(payload.id)).data;
      for (const i of [...(pay.invoices ?? []), ...(pay.paymentables ?? [])]) if (i.invoice_id) ids.add(i.invoice_id);
    }
  } else if (payload.id) ids.add(payload.id);
  let matched = 0;
  for (const id of ids) if (await syncInvoice(id)) matched++;
  if (!matched) return 'No matching invoice';
}
