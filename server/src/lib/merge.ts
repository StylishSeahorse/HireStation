import type { BusinessProfile } from '@prisma/client';
import { formatAbn } from './au.js';
import { formatDate, formatDateTime } from './dates.js';
import { fromCents } from './money.js';
import type { Totals } from './pricing.js';
import { agreementValues } from './agreement.js';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The catalogue of merge fields shown in the editor. */
export const MERGE_FIELDS: { key: string; label: string; group: 'Client' | 'Event' | 'Pricing' | 'Business' | 'Terms' | 'Signing' }[] = [
  { key: 'client_name', label: 'Client name', group: 'Client' },
  { key: 'client_contact', label: 'Client contact person', group: 'Client' },
  { key: 'client_email', label: 'Client email', group: 'Client' },
  { key: 'client_phone', label: 'Client phone', group: 'Client' },
  { key: 'client_abn', label: 'Client ABN', group: 'Client' },
  { key: 'client_address', label: 'Client address', group: 'Client' },
  { key: 'booking_reference', label: 'Booking reference', group: 'Event' },
  { key: 'event_title', label: 'Event title', group: 'Event' },
  { key: 'event_date_range', label: 'Event date range', group: 'Event' },
  { key: 'load_in', label: 'Load-in', group: 'Event' },
  { key: 'load_out', label: 'Load-out', group: 'Event' },
  { key: 'venue', label: 'Venue', group: 'Event' },
  { key: 'venue_address', label: 'Venue address', group: 'Event' },
  { key: 'equipment_table', label: 'Equipment table', group: 'Pricing' },
  { key: 'equipment_list', label: 'Equipment list (plain text, for Docuseal fields)', group: 'Pricing' },
  { key: 'staff_list', label: 'Staff / crew list', group: 'Pricing' },
  { key: 'subtotal', label: 'Subtotal (ex GST)', group: 'Pricing' },
  { key: 'gst_amount', label: 'GST amount', group: 'Pricing' },
  { key: 'total_hire_cost', label: 'Total hire cost', group: 'Pricing' },
  { key: 'bond_amount', label: 'Bond amount', group: 'Pricing' },
  { key: 'business_name', label: 'Business name', group: 'Business' },
  { key: 'business_legal_name', label: 'Business legal name', group: 'Business' },
  { key: 'business_abn', label: 'Business ABN', group: 'Business' },
  { key: 'business_acn', label: 'Business ACN', group: 'Business' },
  { key: 'business_address', label: 'Business address', group: 'Business' },
  { key: 'business_email', label: 'Business email', group: 'Business' },
  { key: 'business_phone', label: 'Business phone', group: 'Business' },
  { key: 'business_bank_bsb', label: 'Bank BSB', group: 'Business' },
  { key: 'business_bank_account', label: 'Bank account number', group: 'Business' },
  { key: 'business_bank_name', label: 'Bank account name', group: 'Business' },
  { key: 'gst_rate', label: 'GST rate', group: 'Business' },
  { key: 'signatory_name', label: 'Signatory name', group: 'Business' },
  { key: 'signatory_title', label: 'Signatory title', group: 'Business' },
  { key: 'fee_delivery', label: 'Delivery / setup fee', group: 'Pricing' },
  { key: 'fee_deposit', label: 'Deposit', group: 'Pricing' },
  { key: 'late_return_fee', label: 'Late return fee', group: 'Terms' },
  { key: 'extension_notice', label: 'Extension notice', group: 'Terms' },
  { key: 'late_payment_pct', label: 'Late payment interest (%/month)', group: 'Terms' },
  { key: 'bond_refund_days', label: 'Bond refund (business days)', group: 'Terms' },
  { key: 'cancel_more_days', label: 'Cancellation: deposit-only days', group: 'Terms' },
  { key: 'cancel_within_days', label: 'Cancellation: late days', group: 'Terms' },
  { key: 'cancel_within_pct', label: 'Cancellation: late % payable', group: 'Terms' },
  { key: 'fee_balance_due', label: 'Balance due', group: 'Terms' },
  { key: 'today', label: "Today's date", group: 'Signing' },
  { key: 'client_signature', label: 'Client signature box', group: 'Signing' },
  { key: 'client_signed_date', label: 'Client signing date', group: 'Signing' },
];

export interface MergeBooking {
  reference: string; title: string; venue: string | null; venueAddress: string | null;
  loadIn: Date; loadOut: Date; eventStart: Date | null; eventEnd: Date | null; bondAmount: unknown;
  client: { name: string; contactName: string | null; email: string | null; phone: string | null; abn: string | null; address: string | null };
  staff: { role: string; staff: { name: string } }[];
}

export function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(fromCents(cents));
}

/** Plain-text values (escaped when rendered) plus HTML-valued fields. */
export function mergeValues(b: MergeBooking, totals: Totals, p: BusinessProfile) {
  const d = (x: Date) => formatDate(x, p.dateFormat, p.timezone);
  const dt = (x: Date) => formatDateTime(x, p.dateFormat, p.timezone);
  const start = b.eventStart ?? b.loadIn;
  const end = b.eventEnd ?? b.loadOut;
  const range = d(start) === d(end) ? d(start) : `${d(start)} – ${d(end)}`;
  const address = [p.addressLine1, p.addressLine2, `${p.suburb} ${p.state} ${p.postcode}`].filter(Boolean).join(', ');
  const cur = p.currency;
  const text: Record<string, string> = {
    client_name: b.client.name, client_contact: b.client.contactName ?? b.client.name,
    client_email: b.client.email ?? '', client_phone: b.client.phone ?? '',
    client_abn: b.client.abn ? formatAbn(b.client.abn) : 'N/A', client_address: b.client.address ?? '',
    booking_reference: b.reference, event_title: b.title, event_date_range: range,
    load_in: dt(b.loadIn), load_out: dt(b.loadOut), venue: b.venue ?? '', venue_address: b.venueAddress ?? '',
    subtotal: money(totals.subtotal, cur), gst_amount: money(totals.gstTotal, cur), total_hire_cost: money(totals.total, cur),
    bond_amount: money(Math.round(Number(b.bondAmount) * 100), cur),
    business_name: p.tradingName || p.legalName, business_legal_name: p.legalName, business_abn: formatAbn(p.abn),
    business_acn: p.acn ?? '', business_address: address, business_email: p.contactEmail, business_phone: p.contactPhone,
    business_bank_bsb: p.bankBsb, business_bank_account: p.bankAccountNumber, business_bank_name: p.bankAccountName,
    gst_rate: p.gstRegistered ? `${Number(p.gstRate)}%` : 'Not registered for GST',
    signatory_name: p.signatoryName ?? '', signatory_title: p.signatoryTitle ?? '',
    today: d(new Date()), client_signed_date: '',
    // Plain-text lines for Docuseal free-edition templates, where fields can't hold HTML tables.
    equipment_list: totals.lines.map((l) => `${l.quantity} × ${l.description}${l.kind === 'HIRE' ? ` (${l.days} day${l.days === 1 ? '' : 's'})` : ''} — ${money(l.lineTotal, cur)}`).join('\n'),
  };
  const rows = totals.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${l.quantity}</td><td class="num">${l.kind === 'HIRE' ? l.days : ''}</td><td class="num">${money(l.unitCost, cur)}</td><td class="num">${money(l.lineTotal, cur)}</td></tr>`).join('');
  const gstRow = p.gstRegistered ? `<tr><td colspan="4" class="num">GST (${Number(p.gstRate)}%)</td><td class="num">${money(totals.gstTotal, cur)}</td></tr>` : '';
  const html: Record<string, string> = {
    equipment_table: `<table class="items"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Days</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="4" class="num">Subtotal${p.gstRegistered ? ' (ex GST)' : ''}</td><td class="num">${money(totals.subtotal, cur)}</td></tr>${gstRow}<tr class="total"><td colspan="4" class="num">Total</td><td class="num">${money(totals.total, cur)}</td></tr></tfoot></table>`,
    staff_list: b.staff.length ? `<ul>${b.staff.map((s) => `<li>${esc(s.staff.name)} — ${esc(s.role)}</li>`).join('')}</ul>` : '',
    client_signature: '<signature-field name="Client Signature" role="Client" required="true" style="display:inline-block;width:240px;height:70px;"></signature-field>',
    client_signed_date: '<date-field name="Signed Date" role="Client" required="true" style="display:inline-block;width:160px;height:24px;"></date-field>',
  };
  // Hire-agreement fields (parties, fees, standard terms) are available to HTML templates too.
  Object.assign(text, agreementValues(b, totals, p));
  return { text, html };
}

/** Replace {{field}} tokens. Unknown tokens are left visible so authors notice typos. */
export function mergeTemplate(content: string, values: { text: Record<string, string>; html: Record<string, string> }) {
  return content.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => {
    if (key in values.html) return values.html[key];
    if (key in values.text) return esc(values.text[key]).replace(/\n/g, '<br>');
    return m;
  });
}

/** Wrap merged content in a branded, print-ready HTML document. */
export function brandedDocument(body: string, p: BusinessProfile, opts: { title: string; logoDataUri?: string | null; ensureSignature?: boolean }) {
  const primary = p.primaryColour ?? '#111827';
  const accent = p.accentColour ?? primary;
  const needsSig = opts.ensureSignature && !body.includes('<signature-field');
  const sig = needsSig
    ? `<div class="sig"><p><strong>Signed for and on behalf of the client</strong></p><p>Signature: <signature-field name="Client Signature" role="Client" required="true" style="display:inline-block;width:240px;height:70px;"></signature-field></p><p>Date: <date-field name="Signed Date" role="Client" required="true" style="display:inline-block;width:160px;height:24px;"></date-field></p></div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #1f2937; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${esc(primary)}; padding-bottom: 10px; margin-bottom: 18px; }
  header img { max-height: 60px; max-width: 220px; }
  header .biz { text-align: right; font-size: 9pt; color: #4b5563; }
  header .biz strong { color: ${esc(primary)}; font-size: 12pt; }
  h1, h2, h3 { color: ${esc(primary)}; }
  a { color: ${esc(accent)}; }
  table.items { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt; }
  table.items th { background: ${esc(primary)}; color: #fff; text-align: left; padding: 6px; }
  table.items td { border-bottom: 1px solid #e5e7eb; padding: 6px; }
  table.items .num { text-align: right; }
  table.items tr.total td { font-weight: bold; border-top: 2px solid ${esc(accent)}; }
  .sig { margin-top: 28px; page-break-inside: avoid; }
  signature-field, date-field { display: inline-block; border-bottom: 1px solid #9ca3af; vertical-align: bottom; }
  footer { margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 8px; font-size: 8.5pt; color: #6b7280; text-align: center; }
  </style></head><body>
  <header>${opts.logoDataUri ? `<img src="${opts.logoDataUri}" alt="">` : '<span></span>'}<div class="biz"><strong>${esc(p.tradingName || p.legalName)}</strong><br>ABN ${esc(formatAbn(p.abn))}<br>${esc(p.contactEmail)} · ${esc(p.contactPhone)}</div></header>
  <main>${body}${sig}</main>
  ${p.documentFooter ? `<footer>${esc(p.documentFooter)}</footer>` : ''}
  </body></html>`;
}
