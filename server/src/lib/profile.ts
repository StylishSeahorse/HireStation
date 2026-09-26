import type { BusinessProfile } from '@prisma/client';
import { prisma } from './db.js';
import { HttpError } from './auth.js';
import { InvoiceNinja } from '../services/invoiceNinja.js';
import { Docuseal } from '../services/docuseal.js';

export const getProfile = () => prisma.businessProfile.findUnique({ where: { id: 1 } });

export async function requireProfile(): Promise<BusinessProfile> {
  const p = await getProfile();
  if (!p) throw new HttpError(409, 'Setup has not been completed');
  return p;
}

export function taxOf(p: BusinessProfile) {
  return { gstRegistered: p.gstRegistered, gstRate: Number(p.gstRate) };
}

/** Profile as sent to the browser: secrets removed, presence flags added. */
export function publicProfile(p: BusinessProfile) {
  const { invoiceNinjaToken, docusealToken, invoiceNinjaWebhookKey, docusealWebhookKey, webhookSecret, docusealWebhookHmacSecret, abrGuid, ...rest } = p;
  return {
    ...rest,
    gstRate: Number(p.gstRate),
    hasInvoiceNinjaToken: !!invoiceNinjaToken,
    hasDocusealToken: !!docusealToken,
    hasAbrGuid: !!abrGuid,
    hasDocusealWebhookHmacSecret: !!docusealWebhookHmacSecret,
    logoUrl: p.logoPath ? `/api/branding/logo?v=${p.updatedAt.getTime()}` : null,
  };
}

export async function invoiceNinjaClient() {
  const p = await requireProfile();
  if (!p.invoiceNinjaUrl || !p.invoiceNinjaToken || !p.invoiceNinjaCompanyId)
    throw new HttpError(412, 'Invoice Ninja is not connected — configure it in Settings');
  return { client: new InvoiceNinja({ url: p.invoiceNinjaUrl, token: p.invoiceNinjaToken }), profile: p };
}

export async function docusealClient() {
  const p = await requireProfile();
  if (!p.docusealUrl || !p.docusealToken) throw new HttpError(412, 'Docuseal is not connected — configure it in Settings');
  return { client: new Docuseal({ url: p.docusealUrl, token: p.docusealToken }), profile: p };
}
