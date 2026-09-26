import { prisma } from '../lib/db.js';
import { generateInvoice, syncInvoice } from '../services/invoicing.js';
import { fetchSignedPdf, sendContract } from '../services/contracts.js';
import { invoiceNinjaClient, docusealClient, getProfile } from '../lib/profile.js';
import { notify } from '../lib/bookings.js';
import type { JobName } from './queue.js';

type Data = Record<string, unknown>;

export const handlers: Record<JobName, (d: Data) => Promise<unknown>> = {
  'invoice.generate': async (d) => {
    const p = await getProfile();
    if (!p?.invoiceNinjaToken) {
      await notify('invoice', 'Return completed but Invoice Ninja is not connected — invoice not generated', d.bookingId as string);
      return;
    }
    return generateInvoice(d.bookingId as string);
  },
  'contract.send': (d) => sendContract(d.contractId as string),
  'contract.fetchSigned': (d) => fetchSignedPdf(d.contractId as string, d.documents as { name: string; url: string }[]),

  'webhook.invoiceNinja': async (d) => {
    const evt = await prisma.webhookEvent.findUnique({ where: { id: d.eventId as string } });
    if (!evt || evt.processed) return;
    const payload = evt.payload as { id?: string; entity_type?: string; invoice_id?: string; invoices?: { invoice_id?: string; id?: string }[]; paymentables?: { invoice_id?: string }[] };
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
    for (const id of ids) await syncInvoice(id);
    await prisma.webhookEvent.update({ where: { id: evt.id }, data: { processed: true } });
  },

  // Periodic scan: unsigned contracts, unreturned gear, upcoming bookings.
  'reminders.scan': async () => {
    const p = await getProfile();
    if (!p) return;
    const now = new Date();
    const cutoff = new Date(now.getTime() + p.contractReminderDays * 86_400_000);
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const unsigned = await prisma.contract.findMany({
      where: { status: { in: ['SENT', 'VIEWED'] }, booking: { loadIn: { lte: cutoff, gte: now } }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: dayAgo } }] },
      include: { booking: true },
    });
    for (const c of unsigned) {
      await notify('reminder', `Contract for ${c.booking.reference} is still unsigned and the event starts ${c.booking.loadIn.toISOString().slice(0, 10)}`, c.bookingId);
      if (c.docusealSubmissionId && p.docusealToken) {
        try {
          const { client } = await docusealClient();
          const subs = await fetch(new URL(`/api/submissions/${c.docusealSubmissionId}`, p.docusealUrl!), { headers: { 'X-Auth-Token': p.docusealToken } }).then((r) => r.json()) as { submitters?: { id: number; status: string }[] };
          for (const s of subs.submitters ?? []) if (s.status !== 'completed') await client.remind(s.id);
        } catch (e) { console.warn('Docuseal reminder failed', e); }
      }
      await prisma.contract.update({ where: { id: c.id }, data: { lastReminderAt: now } });
    }
    const overdue = await prisma.booking.findMany({
      where: { loadOut: { lt: now }, status: { not: 'CANCELLED' }, departure: { completed: true }, OR: [{ returnInventory: null }, { returnInventory: { completed: false } }] },
    });
    for (const b of overdue) {
      const recent = await prisma.notification.findFirst({ where: { bookingId: b.id, kind: 'overdue', createdAt: { gt: dayAgo } } });
      if (!recent) await notify('overdue', `Equipment for ${b.reference} was due back ${b.loadOut.toISOString().slice(0, 16).replace('T', ' ')} and has not been checked in`, b.id);
    }
    const tomorrow = new Date(now.getTime() + 86_400_000);
    const soon = await prisma.booking.findMany({ where: { loadIn: { gte: now, lt: tomorrow }, status: { notIn: ['CANCELLED', 'ENQUIRY'] } } });
    for (const b of soon) {
      const recent = await prisma.notification.findFirst({ where: { bookingId: b.id, kind: 'upcoming' } });
      if (!recent) await notify('upcoming', `${b.reference} (${b.title}) loads in within 24 hours`, b.id);
    }
  },
};
