import { z } from 'zod';

// Friendlier message for missing fields across all API validation.
z.config({ customError: (iss) => (iss.input === undefined || iss.input === null ? 'Required' : undefined) });
import { isValidAbn, isValidAcn, isValidBsb, normaliseDigits, formatBsb } from './au.js';

// Each wizard step / settings section validates with the same schema.
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1a2b3c');
const opt = (s: z.ZodString) => s.optional().nullable().transform((v) => (v ? v : null));

export const identitySchema = z.object({
  legalName: z.string().trim().min(1, 'Required'),
  tradingName: opt(z.string().trim()),
  structure: z.enum(['SOLE_TRADER', 'PARTNERSHIP', 'COMPANY', 'TRUST']),
  abn: z.string().refine(isValidAbn, 'Invalid ABN (checksum failed)').transform(normaliseDigits),
  acn: z.string().optional().nullable()
    .refine((v) => !v || isValidAcn(v), 'Invalid ACN (checksum failed)')
    .transform((v) => (v ? normaliseDigits(v) : null)),
  abrGuid: opt(z.string().trim()),
  addressLine1: z.string().trim().min(1, 'Required'),
  addressLine2: opt(z.string().trim()),
  suburb: z.string().trim().min(1, 'Required'),
  state: z.string().trim().min(2, 'Required'),
  postcode: z.string().regex(/^\d{4}$/, 'Postcode must be 4 digits'),
  contactEmail: z.email(),
  contactPhone: z.string().trim().min(6, 'Required'),
  signatoryName: opt(z.string().trim()),
  signatoryTitle: opt(z.string().trim()),
});

export const taxSchema = z.object({
  gstRegistered: z.boolean(),
  gstRate: z.coerce.number().min(0).max(100),
});

export const bankingSchema = z.object({
  bankBsb: z.string().refine(isValidBsb, 'BSB must be 6 digits (XXX-XXX)').transform(formatBsb),
  bankAccountNumber: z.string().transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\d{4,10}$/, 'Account number must be 4–10 digits')),
  bankAccountName: z.string().trim().min(1, 'Required'),
});

export const brandingSchema = z.object({
  primaryColour: hex.optional().nullable(),
  accentColour: hex.optional().nullable(),
  documentFooter: opt(z.string()),
});

const url = z.url().transform((v) => v.replace(/\/+$/, ''));

export const invoiceNinjaSchema = z.object({
  invoiceNinjaUrl: url,
  invoiceNinjaToken: z.string().optional(), // blank = keep existing
  invoiceNinjaCompanyId: z.string().min(1, 'Choose a company'),
});

export const docusealSchema = z.object({
  docusealUrl: url,
  docusealToken: z.string().optional(),
  // Docuseal → Settings → Webhooks → signing secret (whsec_…). Blank = keep existing.
  docusealWebhookHmacSecret: z.string().trim().optional().refine((v) => !v || v.startsWith('whsec_'), 'Docuseal signing secrets start with whsec_'),
  docusealEdition: z.enum(['pro', 'free']).optional(),
});

export const localeSchema = z.object({
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en-AU', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone'),
  currency: z.string().regex(/^[A-Z]{3}$/),
  dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD-MM-YYYY']),
  holidayRegion: opt(z.string()),
  contractReminderDays: z.coerce.number().int().min(1).max(60).default(3),
});

const optText = z.string().trim().max(200).optional().nullable().transform((v) => (v ? v : null));
const optInt = z.union([z.coerce.number().int().min(0).max(365), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : v));

/** Standard terms merged into hire agreements (the same on every booking). */
export const termsSchema = z.object({
  termsLateReturnFee: optText,        // e.g. "$50 per day"
  termsExtensionNotice: optText,      // e.g. "24 hours"
  termsLatePaymentPct: optText,       // e.g. "2"
  termsBondRefundDays: optInt,        // business days
  termsCancelDepositDays: optInt,     // cancel more than N days before: deposit forfeited, rest refunded
  termsCancelLateDays: optInt,        // cancel within N days …
  termsCancelLatePct: z.union([z.coerce.number().int().min(0).max(100), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : v)), // … P% payable
  termsBalanceDue: optText,           // e.g. "Invoiced after the event"
});

export const sections = {
  identity: identitySchema,
  tax: taxSchema,
  banking: bankingSchema,
  branding: brandingSchema,
  invoiceNinja: invoiceNinjaSchema,
  docuseal: docusealSchema,
  locale: localeSchema,
  terms: termsSchema,
} as const;
export type SectionName = keyof typeof sections;

// Integration steps can be skipped in the wizard (e.g. Docuseal not deployed yet)
// and completed later from Settings; features that need them stay disabled until then.
export const setupSchema = z.object({
  identity: identitySchema,
  tax: taxSchema,
  banking: bankingSchema,
  branding: brandingSchema,
  invoiceNinja: invoiceNinjaSchema.extend({ invoiceNinjaToken: z.string().min(1) }).optional().nullable(),
  docuseal: docusealSchema.extend({ docusealToken: z.string().min(1) }).optional().nullable(),
  locale: localeSchema,
  docusealTemplateMap: z.record(z.string(), z.string()).optional(),
});
