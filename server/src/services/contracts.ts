import type { BusinessProfile } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/auth.js';
import { bookingInclude, notify, quoteTotals, FullBooking } from '../lib/bookings.js';
import { brandedDocument, mergeTemplate, mergeValues, MergeBooking } from '../lib/merge.js';
import { docusealClient, requireProfile, taxOf } from '../lib/profile.js';
import { computeTotals } from '../lib/pricing.js';
import { fileExists, mimeOf, readStored, saveFile } from '../lib/storage.js';
import { IntegrationError } from './http.js';
import { agreementValues, placeEquipment, SECTION_LABEL } from '../lib/agreement.js';
import { isProOnlyError } from './docuseal.js';

export async function logoDataUri(p: BusinessProfile): Promise<string | null> {
  if (!p.logoPath || !fileExists(p.logoPath)) return null;
  return `data:${mimeOf(p.logoPath)};base64,${(await readStored(p.logoPath)).toString('base64')}`;
}

/** Placeholder booking for template previews — generic sample data, never business data. */
export function sampleBooking(): { booking: MergeBooking; lines: Parameters<typeof computeTotals>[0] } {
  const start = new Date(Date.now() + 14 * 86_400_000);
  const end = new Date(start.getTime() + 2 * 86_400_000);
  return {
    booking: {
      reference: 'BK-SAMPLE-0001', title: 'Sample Event', venue: 'Sample Venue', venueAddress: '1 Example Street, Sampletown',
      loadIn: start, loadOut: end, eventStart: start, eventEnd: end, bondAmount: 500,
      client: { name: 'Sample Client Pty Ltd', contactName: 'Alex Sample', email: 'client@example.com', phone: '0400 000 000', abn: null, address: '2 Example Road, Sampletown' },
      staff: [{ role: 'Audio technician', staff: { name: 'Sample Technician' } }],
    },
    lines: [
      { key: 'a', description: 'Sample speaker (pair)', quantity: 2, unitCost: 15000, days: 2, taxable: true, kind: 'HIRE' },
      { key: 'b', description: 'Sample mixing console', quantity: 1, unitCost: 20000, days: 2, taxable: true, kind: 'HIRE' },
    ],
  };
}

export async function renderPreview(content: string, bookingId?: string) {
  const p = await requireProfile();
  let merged: string;
  if (bookingId) {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
    if (!b) throw new HttpError(404, 'Booking not found');
    merged = mergeTemplate(content, mergeValues(b, quoteTotals(b, taxOf(p)), p));
  } else {
    const s = sampleBooking();
    merged = mergeTemplate(content, mergeValues(s.booking, computeTotals(s.lines, taxOf(p)), p));
  }
  return brandedDocument(merged, p, { title: 'Contract preview', logoDataUri: await logoDataUri(p), ensureSignature: true });
}

/** Freeze template version + booking data into a contract record. */
export async function createContract(b: FullBooking, templateId: string) {
  const p = await requireProfile();
  const version = await prisma.contractTemplateVersion.findFirst({ where: { templateId }, orderBy: { version: 'desc' } });
  if (!version) throw new HttpError(404, 'Template has no content yet');
  const mergedContent = mergeTemplate(version.content, mergeValues(b, quoteTotals(b, taxOf(p)), p));
  return prisma.contract.create({ data: { bookingId: b.id, templateVersionId: version.id, mergedContent } });
}

export async function contractHtml(contractId: string) {
  const c = await prisma.contract.findUnique({ where: { id: contractId }, include: { booking: true } });
  if (!c) throw new HttpError(404, 'Contract not found');
  const p = await requireProfile();
  return brandedDocument(c.mergedContent, p, { title: `Hire agreement ${c.booking.reference}`, logoDataUri: await logoDataUri(p), ensureSignature: true });
}

export async function sendContract(contractId: string) {
  const c = await prisma.contract.findUnique({ where: { id: contractId }, include: { booking: { include: { client: true } }, templateVersion: { include: { template: true } } } });
  if (!c) throw new HttpError(404, 'Contract not found');
  if (c.docusealSubmissionId) return c; // idempotent on job retry
  const email = c.booking.client.email;
  if (!email) throw new HttpError(400, 'Client has no email address — Docuseal needs one to send the signing link');
  const { client: ds, profile } = await docusealClient();
  const signer = { name: c.booking.client.contactName || c.booking.client.name, email };
  const name = `Hire agreement ${c.booking.reference}`;
  const message = { subject: `Please sign: ${name}`, body: `Hi {{submitter.name}},\n\nPlease review and sign your hire agreement for ${c.booking.title}.\n\n{{submitter.link}}\n\n${profile.tradingName || profile.legalName}` };
  const mapped = c.templateVersion.template.docusealTemplateId;
  assertSendable(profile, mapped);
  let res;
  if (mapped) {
    // Mapped mode: the Docuseal template carries the layout; merge values prefill (and lock) its fields.
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId }, include: bookingInclude });
    const values = await templateValues(b, c.templateVersion.template, profile);
    if (c.templateVersion.template.equipmentOverflow) {
      // Cosmetic only: a failure here must not stop the contract going out.
      await ds.topAlignField(Number(mapped), 'equipment overflow').catch(() => undefined);
    }
    res = await ds.submitTemplate({ templateId: Number(mapped), signer, values, message });
  } else {
    // Pro edition: this app's merged, branded HTML is the document that gets signed.
    try {
      res = await ds.submitHtml({ name, html: await contractHtml(c.id), signer, message });
    } catch (e) {
      if (e instanceof IntegrationError && isProOnlyError(e)) {
        await prisma.businessProfile.update({ where: { id: 1 }, data: { docusealEdition: 'free' } });
        throw new HttpError(412, FREE_EDITION_MESSAGE);
      }
      throw e;
    }
  }
  const updated = await prisma.contract.update({
    where: { id: c.id },
    data: { docusealSubmissionId: String(res.submissionId), docusealSubmitterSlug: res.slug ?? null, status: 'SENT', sentAt: new Date() },
  });
  await prisma.booking.update({ where: { id: c.bookingId }, data: { status: 'CONTRACT_SENT' } });
  await notify('contract', `Contract sent to ${email} for ${c.booking.reference}`, c.bookingId);
  return updated;
}

/**
 * Values for a mapped Docuseal template: generic merge fields, the hire-agreement fields, and (for
 * templates with fixed equipment rows) the equipment placed into its rows. Throws if the booking
 * doesn't fit a template without an overflow schedule, suggesting a bigger template.
 */
export async function templateValues(b: FullBooking, t: { id: string; name: string; equipmentRows: number | null; equipmentOverflow: boolean }, profile: BusinessProfile) {
  const totals = quoteTotals(b, taxOf(profile));
  const values: Record<string, string> = { ...mergeValues(b, totals, profile).text, ...agreementValues(b, totals, profile) };
  if (t.equipmentRows) {
    const placed = placeEquipment(b.lineItems, t.equipmentRows);
    if (placed.overflow.length && !t.equipmentOverflow) await throwDoesNotFit(t, placed.overLimit);
    Object.assign(values, placed.values);
  }
  return values;
}

async function throwDoesNotFit(t: { id: string; name: string; equipmentRows: number | null }, overLimit: Record<string, number | undefined>) {
  const detail = Object.entries(overLimit).filter(([, n]) => n).map(([k, n]) => k === 'uncategorised'
    ? `${n} uncategorised item${n === 1 ? '' : 's'}`
    : `${n} ${SECTION_LABEL[k as keyof typeof SECTION_LABEL]} item${n === 1 ? '' : 's'} too many`).join(', ');
  const bigger = await prisma.contractTemplate.findFirst({
    where: { archived: false, id: { not: t.id }, docusealTemplateId: { not: null }, OR: [{ equipmentRows: { gt: t.equipmentRows ?? 0 } }, { equipmentOverflow: true }] },
    orderBy: { equipmentRows: 'desc' },
  });
  const uncategorised = overLimit.uncategorised
    ? ' Items without a Sound / Lighting / Visual / Cables / Staging category can only go on an overflow schedule — or set their category.'
    : '';
  throw new HttpError(412, `This booking's equipment doesn't fit "${t.name}" (${t.equipmentRows} rows per category; ${detail}).` +
    (bigger ? ` Use "${bigger.name}" instead.` : ' Use a template with more rows or an overflow schedule.') + uncategorised);
}

/** Request-time check (before queueing a send) so the user sees the problem immediately. */
export async function assertFits(bookingId: string, templateId: string) {
  const t = await prisma.contractTemplate.findUnique({ where: { id: templateId } });
  if (!t?.equipmentRows || t.equipmentOverflow) return;
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: bookingInclude });
  const placed = placeEquipment(b.lineItems, t.equipmentRows);
  if (placed.overflow.length) await throwDoesNotFit(t, placed.overLimit);
}

export const FREE_EDITION_MESSAGE =
  'Your Docuseal is the free edition, which can only send templates built in Docuseal. Map this contract template to a Docuseal template (Contracts → template → Docuseal template), then send again.';

/** Free-edition Docuseal can't sign arbitrary documents, so unmapped templates can't be sent. */
export function assertSendable(profile: BusinessProfile, docusealTemplateId: string | null) {
  if (!docusealTemplateId && profile.docusealEdition === 'free') throw new HttpError(412, FREE_EDITION_MESSAGE);
}

/** Download the completed PDF from Docuseal and keep our own copy. */
export async function fetchSignedPdf(contractId: string, documents?: { name: string; url: string }[]) {
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!c?.docusealSubmissionId) return;
  if (c.signedPdfPath && fileExists(c.signedPdfPath)) return;
  const { client: ds, profile } = await docusealClient();
  const docs = documents?.length ? documents : await ds.getDocuments(c.docusealSubmissionId);
  if (!docs.length) throw new Error('Docuseal returned no documents yet');
  // Docuseal builds file links on its public HOST. Fetch the same path via the configured API
  // URL instead, so an internal address (e.g. http://docuseal:3000) works and we avoid hairpin NAT.
  const link = new URL(docs[0].url, profile.docusealUrl!);
  const url = new URL(link.pathname + link.search, profile.docusealUrl!.replace(/\/+$/, '') + '/').toString();
  const res = await fetch(url, { headers: { 'X-Auth-Token': profile.docusealToken! } });
  if (!res.ok) throw new Error(`Failed to download signed PDF: HTTP ${res.status}`);
  const path = await saveFile('contracts', 'signed.pdf', Buffer.from(await res.arrayBuffer()));
  await prisma.contract.update({ where: { id: c.id }, data: { signedPdfPath: path } });
}
