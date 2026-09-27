import type { BusinessProfile } from '@prisma/client';
import { formatAbn } from './au.js';
import { formatDate, formatDateTime } from './dates.js';
import { fromCents } from './money.js';
import type { Totals } from './pricing.js';
import type { MergeBooking } from './merge.js';

// Field values for fixed-layout hire agreements (Docuseal templates built from fillable PDFs).
// Keys match the PDF field names with spaces → underscores, e.g. "equipment sound 01 item".

export const SECTIONS = ['sound', 'lighting', 'visual', 'cables', 'staging'] as const;
export type Section = (typeof SECTIONS)[number];
export const MAX_ROWS = 10;

// Category name keywords → agreement section (checked on the item's category, then its parent).
const SECTION_KEYWORDS: [Section, RegExp][] = [
  ['cables', /cabl|lead|loom|power dist|extension/i],
  ['staging', /stag|truss|riser|deck|platform|rigging/i],
  ['lighting', /light|lamp|fixture|dmx|haze|fog|smoke/i],
  ['visual', /visual|video|screen|led wall|projector|projection|display|tv|monitor/i],
  ['sound', /sound|audio|speaker|pa\b|mic|mixer|console|amp|dj|subwoofer|foldback/i],
];

export function sectionFor(category?: { name: string; parent?: { name: string } | null } | null): Section | null {
  for (const name of [category?.name, category?.parent?.name]) {
    if (!name) continue;
    for (const [section, re] of SECTION_KEYWORDS) if (re.test(name)) return section;
  }
  return null;
}

export interface AgreementLine {
  equipment: { name: string; replacementValue: unknown; category?: { name: string; parent?: { name: string } | null } | null };
  qtyBooked: number;
  conditionNote?: string | null;
}

export interface AgreementBooking extends MergeBooking {
  lineItems: AgreementLine[];
  deliveryFee: unknown;
  depositAmount: unknown;
}

const num = (v: unknown) => Number((v ?? 0).toString());
const amount = (v: number) => new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

export interface Placement {
  values: Record<string, string>;
  /** Lines that didn't fit their section (or have no section), in booking order. */
  overflow: AgreementLine[];
  /** Section → number of lines that didn't fit. */
  overLimit: Partial<Record<Section | 'uncategorised', number>>;
}

/** Place equipment lines into the per-section rows; unused rows are sent empty so Docuseal locks them. */
export function placeEquipment(lines: AgreementLine[], rows: number): Placement {
  const values: Record<string, string> = {};
  const used: Record<Section, number> = { sound: 0, lighting: 0, visual: 0, cables: 0, staging: 0 };
  const overflow: AgreementLine[] = [];
  const overLimit: Placement['overLimit'] = {};
  for (const line of lines) {
    const section = sectionFor(line.equipment.category);
    if (!section) { overflow.push(line); overLimit.uncategorised = (overLimit.uncategorised ?? 0) + 1; continue; }
    if (used[section] >= rows) { overflow.push(line); overLimit[section] = (overLimit[section] ?? 0) + 1; continue; }
    const n = String(++used[section]).padStart(2, '0');
    const unit = num(line.equipment.replacementValue);
    values[`equipment_${section}_${n}_item`] = line.equipment.name;
    values[`equipment_${section}_${n}_qty`] = String(line.qtyBooked);
    values[`equipment_${section}_${n}_cond`] = line.conditionNote?.trim() || 'Good';
    values[`equipment_${section}_${n}_val`] = unit > 0 ? amount(unit * line.qtyBooked) : '';
  }
  for (const s of SECTIONS) for (let i = 1; i <= MAX_ROWS; i++) {
    const n = String(i).padStart(2, '0');
    for (const col of ['item', 'qty', 'cond', 'val']) values[`equipment_${s}_${n}_${col}`] ??= '';
  }
  values.equipment_overflow = overflow.map((l) => {
    const unit = num(l.equipment.replacementValue);
    return `${l.qtyBooked} x ${l.equipment.name} - ${l.conditionNote?.trim() || 'Good'}${unit > 0 ? ` - $${amount(unit * l.qtyBooked)}` : ''}`;
  }).join('\n') || 'None';
  return { values, overflow, overLimit };
}

/** Everything else on the agreement: parties, event, fees, terms, and the pre-filled owner signature block. */
export function agreementValues(b: MergeBooking & { depositAmount?: unknown }, totals: Totals, p: BusinessProfile, now = new Date()): Record<string, string> {
  const d = (x: Date) => formatDate(x, p.dateFormat, p.timezone);
  const dt = (x: Date) => formatDateTime(x, p.dateFormat, p.timezone);
  const time = (x: Date) => new Intl.DateTimeFormat('en-AU', { timeZone: p.timezone, hour: 'numeric', minute: '2-digit' }).format(x);
  const start = b.eventStart ?? b.loadIn;
  const end = b.eventEnd ?? b.loadOut;
  const businessName = p.tradingName || p.legalName;
  const businessAddress = [p.addressLine1, p.addressLine2, `${p.suburb} ${p.state} ${p.postcode}`].filter(Boolean).join(', ');
  const deliveryCents = totals.lines.filter((l) => l.kind === 'DELIVERY').reduce((a, l) => a + l.lineTotal, 0);
  const deposit = num(b.depositAmount);
  const signatory = p.signatoryName || businessName;
  return {
    owner_business_name: businessName,
    owner_abn: formatAbn(p.abn),
    owner_address: businessAddress,
    owner_phone: p.contactPhone,
    owner_email: p.contactEmail,
    hirer_name: b.client.contactName && b.client.contactName !== b.client.name ? `${b.client.name} (${b.client.contactName})` : b.client.name,
    hirer_abn: b.client.abn ? formatAbn(b.client.abn) : 'N/A',
    hirer_address: b.client.address ?? '',
    hirer_phone: b.client.phone ?? '',
    hirer_email: b.client.email ?? '',
    event_name: b.title,
    event_date: d(start) === d(end) ? d(start) : `${d(start)} - ${d(end)}`,
    venue_address: [b.venue, b.venueAddress].filter(Boolean).join(', '),
    bumpin_datetime: dt(b.loadIn),
    bumpout_datetime: dt(b.loadOut),
    event_times: b.eventStart && b.eventEnd ? `${time(b.eventStart)} - ${time(b.eventEnd)}` : '',
    late_return_fee: p.termsLateReturnFee ?? '',
    extension_notice: p.termsExtensionNotice ?? '',
    fee_hire_excl_gst: amount(fromCents(totals.subtotal - deliveryCents)),
    fee_gst: amount(fromCents(totals.gstTotal)),
    fee_delivery: deliveryCents ? amount(fromCents(deliveryCents)) : 'Nil',
    fee_bond: num(b.bondAmount) > 0 ? amount(num(b.bondAmount)) : 'Nil',
    fee_deposit: deposit > 0 ? amount(deposit) : 'Nil',
    fee_balance_due: p.termsBalanceDue ?? '',
    payment_details: `By invoice. EFT to ${p.bankAccountName}, BSB ${p.bankBsb}, Account ${p.bankAccountNumber}.`,
    late_payment_pct: p.termsLatePaymentPct ?? '',
    bond_refund_days: p.termsBondRefundDays != null ? String(p.termsBondRefundDays) : '',
    cancel_more_days: p.termsCancelDepositDays != null ? String(p.termsCancelDepositDays) : '',
    cancel_within_days: p.termsCancelLateDays != null ? String(p.termsCancelLateDays) : '',
    cancel_within_pct: p.termsCancelLatePct != null ? String(p.termsCancelLatePct) : '',
    // Owner signs by pre-filled typed name; only the client signs in Docuseal.
    owner_sig_signature: signatory,
    owner_sig_date: d(now),
    owner_sig_print_name: signatory,
    owner_sig_position: p.signatoryTitle ?? '',
  };
}

export const SECTION_LABEL: Record<Section | 'uncategorised', string> = {
  sound: 'Sound', lighting: 'Lighting', visual: 'Visual', cables: 'Cables', staging: 'Staging', uncategorised: 'Uncategorised',
};
