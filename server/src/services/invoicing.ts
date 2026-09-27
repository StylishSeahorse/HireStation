import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/auth.js';
import { bookingInclude, notify, usageTotals } from '../lib/bookings.js';
import { invoiceNinjaClient, taxOf } from '../lib/profile.js';
import { fromCents } from '../lib/money.js';
import { formatAbn } from '../lib/au.js';
import { formatDate } from '../lib/dates.js';
import { IN_STATUS, InLineItem, InInvoice, InvoiceNinja } from './invoiceNinja.js';
import type { Totals } from '../lib/pricing.js';

async function ensureClient(inClient: InvoiceNinja, clientId: string): Promise<string> {
  const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (c.invoiceNinjaClientId) return c.invoiceNinjaClientId;
  const id = (await inClient.findClient(c.email, c.abn)) ?? (await inClient.createClient(c));
  try {
    await prisma.client.update({ where: { id: c.id }, data: { invoiceNinjaClientId: id } });
  } catch (e) {
    // Another HireStation client is already linked to this Invoice Ninja client (a local duplicate).
    // Invoice under that Invoice Ninja client anyway; the link stays with the first one.
    if ((e as { code?: string }).code !== 'P2002') throw e;
  }
  return id;
}

function toLineItems(t: Totals, gstRate: number, gstRegistered: boolean): InLineItem[] {
  return t.lines.map((l) => ({
    product_key: l.kind === 'HIRE' ? l.description : l.kind.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    // Quantity below is units × days, so spell both out to avoid "qty 4" reading as four units.
    notes: l.kind === 'HIRE' ? `${l.quantity} × ${l.description} × ${l.days} day${l.days === 1 ? '' : 's'} hire` : l.description,
    // Days fold into quantity so Invoice Ninja's quantity × cost matches our line total.
    quantity: l.quantity * l.days,
    cost: fromCents(l.unitCost),
    tax_name1: gstRegistered && l.taxable ? 'GST' : '',
    tax_rate1: gstRegistered && l.taxable ? gstRate : 0,
    type_id: '1',
  }));
}

function mirrorStatus(inv: InInvoice) {
  return IN_STATUS[String(inv.status_id)] ?? 'DRAFT';
}

/**
 * Create (or refresh) the invoice for a booking from its completed return record.
 * - No invoice yet → create one.
 * - Draft invoice exists → update its lines in place.
 * - Invoice already sent/paid → raise an adjustment invoice or credit note for the difference.
 */
export async function generateInvoice(bookingId: string, opts: { adjust?: boolean } = {}) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!b) throw new HttpError(404, 'Booking not found');
  if (!b.returnInventory?.completed) throw new HttpError(409, 'Invoices are generated from the completed return checklist');
  const { client: api, profile } = await invoiceNinjaClient();
  const tax = taxOf(profile);
  const totals = (await usageTotals(b, tax))!;
  const lines = toLineItems(totals, tax.gstRate, tax.gstRegistered);
  const clientId = await ensureClient(api, b.clientId);
  const eventDate = formatDate(b.eventStart ?? b.loadIn, profile.dateFormat, profile.timezone);
  const notes = [
    `Booking ${b.reference} — ${b.title}${b.venue ? ` @ ${b.venue}` : ''} (${eventDate})`,
    `Supplier ABN: ${formatAbn(profile.abn)}`,
    Number(b.bondAmount) > 0 ? 'Security bond is held separately and is not included in this invoice unless forfeited.' : '',
  ].filter(Boolean).join('\n');

  const primary = b.invoices.find((i) => i.kind === 'INVOICE' && i.invoiceNinjaInvoiceId && i.status !== 'CANCELLED');
  const snapshot = { subtotal: fromCents(totals.subtotal), gstTotal: fromCents(totals.gstTotal), total: fromCents(totals.total), payload: JSON.parse(JSON.stringify(totals)) };

  let result;
  if (!primary) {
    const { data } = await api.createInvoice({ client_id: clientId, line_items: lines, public_notes: notes, po_number: b.reference });
    result = await prisma.invoice.create({ data: { bookingId: b.id, kind: 'INVOICE', invoiceNinjaInvoiceId: data.id, number: data.number, status: mirrorStatus(data), hostedUrl: data.invitations?.[0]?.link ?? null, ...snapshot } });
  } else {
    const current = (await api.getInvoice(primary.invoiceNinjaInvoiceId!)).data;
    if (mirrorStatus(current) === 'DRAFT') {
      const { data } = await api.updateInvoice(current.id, { line_items: lines, public_notes: notes });
      result = await prisma.invoice.update({ where: { id: primary.id }, data: { status: mirrorStatus(data), number: data.number, ...snapshot } });
    } else {
      if (!opts.adjust) return primary; // already issued; only explicit adjustments create follow-ups
      const billed = b.invoices.filter((i) => i.status !== 'CANCELLED').reduce((a, i) => a + Number(i.total) * (i.kind === 'CREDIT' ? -1 : 1), 0);
      const diff = Math.round((snapshot.total - billed) * 100) / 100;
      if (Math.abs(diff) < 0.01) return primary;
      const gstFactor = tax.gstRegistered ? 1 + tax.gstRate / 100 : 1;
      const exGst = Math.round((Math.abs(diff) / gstFactor) * 100) / 100;
      const adj: InLineItem[] = [{ product_key: 'Adjustment', notes: `Adjustment to booking ${b.reference}`, quantity: 1, cost: exGst, tax_name1: tax.gstRegistered ? 'GST' : '', tax_rate1: tax.gstRegistered ? tax.gstRate : 0 }];
      const kind = diff > 0 ? 'ADJUSTMENT' : 'CREDIT';
      const { data } = diff > 0
        ? await api.createInvoice({ client_id: clientId, line_items: adj, public_notes: notes, po_number: b.reference })
        : await api.createCredit({ client_id: clientId, line_items: adj, public_notes: notes });
      result = await prisma.invoice.create({
        data: {
          bookingId: b.id, kind, invoiceNinjaInvoiceId: data.id, number: data.number, status: kind === 'CREDIT' ? 'CREDIT' : mirrorStatus(data),
          subtotal: exGst, gstTotal: Math.round((Math.abs(diff) - exGst) * 100) / 100, total: Math.abs(diff),
          hostedUrl: data.invitations?.[0]?.link ?? null, payload: { adjustmentFor: primary.id },
        },
      });
    }
  }
  if (['COMPLETED', 'CONTRACT_SIGNED', 'CONFIRMED', 'CONTRACT_SENT', 'CONTRACT_VIEWED'].includes(b.status))
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'INVOICED' } });
  await notify('invoice', `Invoice ${result.number ?? ''} generated for ${b.reference}`.replace('  ', ' '), b.id);
  return result;
}

/** Pull the latest state of an Invoice Ninja invoice into the local mirror and booking status. */
export async function syncInvoice(invoiceNinjaId: string) {
  const local = await prisma.invoice.findFirst({ where: { invoiceNinjaInvoiceId: invoiceNinjaId } });
  if (!local) return null;
  const { client: api } = await invoiceNinjaClient();
  const inv = (await api.getInvoice(invoiceNinjaId)).data;
  const status = local.kind === 'CREDIT' ? 'CREDIT' : mirrorStatus(inv);
  await prisma.invoice.update({
    where: { id: local.id },
    data: { status, number: inv.number, amountPaid: inv.paid_to_date ?? 0, hostedUrl: inv.invitations?.[0]?.link ?? local.hostedUrl },
  });
  // Booking is PAID once every non-credit invoice is paid.
  const all = await prisma.invoice.findMany({ where: { bookingId: local.bookingId, kind: { not: 'CREDIT' }, status: { not: 'CANCELLED' } } });
  if (all.length && all.every((i) => i.status === 'PAID')) {
    const b = await prisma.booking.update({ where: { id: local.bookingId }, data: { status: 'PAID' } });
    await notify('payment', `${b.reference} is paid in full`, b.id);
  }
  return status;
}
