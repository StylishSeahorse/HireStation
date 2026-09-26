import type { BusinessProfile } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/auth.js';
import { bookingInclude, notify, quoteTotals, FullBooking } from '../lib/bookings.js';
import { brandedDocument, mergeTemplate, mergeValues, MergeBooking } from '../lib/merge.js';
import { docusealClient, requireProfile, taxOf } from '../lib/profile.js';
import { computeTotals } from '../lib/pricing.js';
import { fileExists, mimeOf, readStored, saveFile } from '../lib/storage.js';

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
  const mapped = c.templateVersion.template.docusealTemplateId;
  let res;
  if (mapped) {
    // Mapped mode: the Docuseal template carries the layout; merge values prefill its fields.
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId }, include: bookingInclude });
    const values = mergeValues(b, quoteTotals(b, taxOf(profile)), profile).text;
    res = await ds.submitTemplate({ templateId: Number(mapped), signer, values });
  } else {
    // Default: this app's merged, branded HTML is the document that gets signed.
    res = await ds.submitHtml({
      name, html: await contractHtml(c.id), signer,
      message: { subject: `Please sign: ${name}`, body: `Hi {{submitter.name}},\n\nPlease review and sign your hire agreement for ${c.booking.title}.\n\n{{submitter.link}}\n\n${profile.tradingName || profile.legalName}` },
    });
  }
  const updated = await prisma.contract.update({
    where: { id: c.id },
    data: { docusealSubmissionId: String(res.submissionId), docusealSubmitterSlug: res.slug ?? null, status: 'SENT', sentAt: new Date() },
  });
  await prisma.booking.update({ where: { id: c.bookingId }, data: { status: 'CONTRACT_SENT' } });
  await notify('contract', `Contract sent to ${email} for ${c.booking.reference}`, c.bookingId);
  return updated;
}

/** Download the completed PDF from Docuseal and keep our own copy. */
export async function fetchSignedPdf(contractId: string, documents?: { name: string; url: string }[]) {
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!c?.docusealSubmissionId) return;
  if (c.signedPdfPath && fileExists(c.signedPdfPath)) return;
  const { client: ds, profile } = await docusealClient();
  const docs = documents?.length ? documents : await ds.getDocuments(c.docusealSubmissionId);
  if (!docs.length) throw new Error('Docuseal returned no documents yet');
  // Document URLs may be relative to the Docuseal host.
  const url = new URL(docs[0].url, profile.docusealUrl!).toString();
  const res = await fetch(url, { headers: { 'X-Auth-Token': profile.docusealToken! } });
  if (!res.ok) throw new Error(`Failed to download signed PDF: HTTP ${res.status}`);
  const path = await saveFile('contracts', 'signed.pdf', Buffer.from(await res.arrayBuffer()));
  await prisma.contract.update({ where: { id: c.id }, data: { signedPdfPath: path } });
}
