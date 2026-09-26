import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError, requireRole, startSession } from '../lib/auth.js';
import { getProfile } from '../lib/profile.js';
import { setupSchema } from '../lib/settingsSchema.js';
import { lookupAbn } from '../services/abr.js';
import { InvoiceNinja } from '../services/invoiceNinja.js';
import { Docuseal } from '../services/docuseal.js';
import { isValidAbn, normaliseDigits } from '../lib/au.js';
import { saveFile } from '../lib/storage.js';
import { publicUser } from './auth.js';

export const adminSchema = z.object({
  name: z.string().trim().min(1),
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(10, 'Password must be at least 10 characters'),
});

export const newWebhookKey = () => randomBytes(24).toString('hex');

/** During first run: only the wizard's admin may act. After setup: any admin (settings reuse these tools). */
async function requireSetupActor(req: Parameters<typeof requireRole>[0]) {
  requireRole(req, 'ADMIN');
}

export async function setupRoutes(app: FastifyInstance) {
  app.get('/api/setup/status', async () => {
    const [profile, users] = await Promise.all([getProfile(), prisma.user.count()]);
    return { needsSetup: !profile, hasAdmin: users > 0 };
  });

  // STEP 1 — only possible while no user exists at all.
  app.post('/api/setup/admin', async (req, reply) => {
    const body = adminSchema.parse(req.body);
    const user = await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw new HttpError(409, 'An admin account already exists — sign in instead');
      return tx.user.create({ data: { name: body.name, email: body.email, role: 'ADMIN', passwordHash: await bcrypt.hash(body.password, 12) } });
    });
    startSession(reply, user.id);
    return publicUser(user);
  });

  app.post('/api/setup/abn-lookup', async (req) => {
    await requireSetupActor(req);
    const body = z.object({ abn: z.string(), guid: z.string().optional() }).parse(req.body);
    if (!isValidAbn(body.abn)) throw new HttpError(400, 'Invalid ABN');
    const guid = body.guid || (await getProfile())?.abrGuid;
    if (!guid) throw new HttpError(400, 'An ABN Lookup GUID is required (register free at abr.business.gov.au)');
    return lookupAbn(normaliseDigits(body.abn), guid);
  });

  app.post('/api/setup/test/invoice-ninja', async (req) => {
    await requireSetupActor(req);
    const body = z.object({ url: z.url(), token: z.string().optional() }).parse(req.body);
    const token = body.token || (await getProfile())?.invoiceNinjaToken;
    if (!token) throw new HttpError(400, 'API token is required');
    const companies = await new InvoiceNinja({ url: body.url, token }).listCompanies();
    return { ok: true, companies };
  });

  app.post('/api/setup/test/docuseal', async (req) => {
    await requireSetupActor(req);
    const body = z.object({ url: z.url(), token: z.string().optional() }).parse(req.body);
    const token = body.token || (await getProfile())?.docusealToken;
    if (!token) throw new HttpError(400, 'API token is required');
    const templates = await new Docuseal({ url: body.url, token }).listTemplates();
    return { ok: true, templates };
  });

  // Logo is uploaded ahead of "Finish" and referenced by path in the finish payload.
  app.post('/api/setup/logo', async (req) => {
    await requireSetupActor(req);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No file uploaded');
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.mimetype)) throw new HttpError(400, 'Logo must be PNG, JPEG, WebP or SVG');
    const path = await saveFile('branding', file.filename, await file.toBuffer());
    return { logoPath: path };
  });

  app.post('/api/setup/finish', async (req) => {
    await requireSetupActor(req);
    const body = setupSchema.extend({ logoPath: z.string().regex(/^branding\/[\w-]+\.\w+$/).optional().nullable() }).parse(req.body);
    const data = {
      ...body.identity, ...body.tax, ...body.banking, ...body.branding, ...body.locale,
      logoPath: body.logoPath ?? null,
      invoiceNinjaUrl: body.invoiceNinja?.invoiceNinjaUrl ?? null,
      invoiceNinjaToken: body.invoiceNinja?.invoiceNinjaToken ?? null,
      invoiceNinjaCompanyId: body.invoiceNinja?.invoiceNinjaCompanyId ?? null,
      docusealUrl: body.docuseal?.docusealUrl ?? null,
      docusealToken: body.docuseal?.docusealToken ?? null,
      invoiceNinjaWebhookKey: newWebhookKey(),
      docusealWebhookKey: newWebhookKey(),
    };
    await prisma.$transaction(async (tx) => {
      if (await tx.businessProfile.findUnique({ where: { id: 1 } })) throw new HttpError(409, 'Setup already completed');
      await tx.businessProfile.create({ data: { id: 1, ...data } });
    });
    return { ok: true };
  });

  // Convenience for the frontend wizard to know who is running it.
  app.get('/api/setup/whoami', async (req) => ({ user: req.user ? publicUser(req.user) : null }));
}
