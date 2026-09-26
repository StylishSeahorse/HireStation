import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError, requireRole } from '../lib/auth.js';
import { publicProfile, requireProfile, invoiceNinjaClient } from '../lib/profile.js';
import { sections, SectionName } from '../lib/settingsSchema.js';
import { saveFile, removeFile, fileExists, openFile, mimeOf } from '../lib/storage.js';
import { env } from '../lib/env.js';
import { adminSchema, newWebhookKey } from './setup.js';
import { publicUser } from './auth.js';
import { WEBHOOK_SECRET_HEADER } from './webhooks.js';
import type { BusinessProfile } from '@prisma/client';

/** Existing installs predate the header secret; create it on first admin view. */
async function ensureWebhookSecret(p: BusinessProfile) {
  if (p.webhookSecret) return p;
  return prisma.businessProfile.update({ where: { id: 1 }, data: { webhookSecret: newWebhookKey() } });
}

export function webhookUrls(p: { invoiceNinjaWebhookKey: string | null; docusealWebhookKey: string | null }) {
  const base = env.publicUrl.replace(/\/+$/, '');
  return {
    invoiceNinja: p.invoiceNinjaWebhookKey ? `${base}/api/webhooks/invoice-ninja/${p.invoiceNinjaWebhookKey}` : null,
    docuseal: p.docusealWebhookKey ? `${base}/api/webhooks/docuseal/${p.docusealWebhookKey}` : null,
  };
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async (req) => {
    let p = await requireProfile();
    if (req.user?.role !== 'ADMIN') return { ...publicProfile(p), webhookUrls: null, webhookSecret: null };
    p = await ensureWebhookSecret(p);
    return { ...publicProfile(p), webhookUrls: webhookUrls(p), webhookSecretHeader: WEBHOOK_SECRET_HEADER, webhookSecret: p.webhookSecret };
  });

  app.post('/api/settings/webhook-secret', async (req) => {
    requireRole(req, 'ADMIN');
    await prisma.businessProfile.update({ where: { id: 1 }, data: { webhookSecret: newWebhookKey() } });
    return { ok: true };
  });

  app.put<{ Params: { section: string } }>('/api/settings/:section', async (req) => {
    requireRole(req, 'ADMIN');
    const name = req.params.section as SectionName;
    if (!(name in sections)) throw new HttpError(404, 'Unknown settings section');
    const data: Record<string, unknown> = sections[name].parse(req.body);
    // Blank secret fields mean "keep the stored value".
    for (const k of ['invoiceNinjaToken', 'docusealToken', 'abrGuid']) if (k in data && !data[k]) delete data[k];
    const updated = await prisma.businessProfile.update({ where: { id: 1 }, data });
    return publicProfile(updated);
  });

  app.post<{ Params: { which: string } }>('/api/settings/webhook-key/:which', async (req) => {
    requireRole(req, 'ADMIN');
    const field = req.params.which === 'docuseal' ? 'docusealWebhookKey' : 'invoiceNinjaWebhookKey';
    const p = await prisma.businessProfile.update({ where: { id: 1 }, data: { [field]: newWebhookKey() } });
    return webhookUrls(p);
  });

  app.post('/api/settings/invoice-ninja/register-webhooks', async (req) => {
    requireRole(req, 'ADMIN');
    const { client, profile } = await invoiceNinjaClient();
    const url = webhookUrls(profile).invoiceNinja;
    if (!url || !env.publicUrl) throw new HttpError(400, 'PUBLIC_URL must be set for webhooks to be reachable');
    const secret = (await ensureWebhookSecret(profile)).webhookSecret!;
    await client.registerWebhooks(url, { [WEBHOOK_SECRET_HEADER]: secret });
    return { ok: true, url };
  });

  app.post('/api/settings/logo', async (req) => {
    requireRole(req, 'ADMIN');
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No file uploaded');
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.mimetype)) throw new HttpError(400, 'Logo must be PNG, JPEG, WebP or SVG');
    const old = await requireProfile();
    const logoPath = await saveFile('branding', file.filename, await file.toBuffer());
    const p = await prisma.businessProfile.update({ where: { id: 1 }, data: { logoPath } });
    if (old.logoPath) await removeFile(old.logoPath);
    return publicProfile(p);
  });

  app.delete('/api/settings/logo', async (req) => {
    requireRole(req, 'ADMIN');
    const old = await requireProfile();
    const p = await prisma.businessProfile.update({ where: { id: 1 }, data: { logoPath: null } });
    if (old.logoPath) await removeFile(old.logoPath);
    return publicProfile(p);
  });

  // Public branding (used on the sign-in screen, and in contract previews).
  app.get('/api/branding', async () => {
    const p = await requireProfile();
    return { name: p.tradingName || p.legalName, primaryColour: p.primaryColour, accentColour: p.accentColour, logoUrl: publicProfile(p).logoUrl };
  });

  app.get('/api/branding/logo', async (_req, reply) => {
    const p = await requireProfile();
    if (!p.logoPath || !fileExists(p.logoPath)) throw new HttpError(404, 'No logo');
    reply.header('Content-Type', mimeOf(p.logoPath));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(openFile(p.logoPath));
  });

  // ---- Audit log (admin) ----
  app.get<{ Querystring: { q?: string; userId?: string; entity?: string; entityId?: string; before?: string } }>('/api/audit', async (req) => {
    requireRole(req, 'ADMIN');
    const { q, userId, entity, entityId, before } = req.query;
    return prisma.auditLog.findMany({
      where: {
        ...(userId ? { userId } : {}), ...(entity ? { entity } : {}), ...(entityId ? { entityId } : {}),
        ...(q ? { OR: [{ action: { contains: q, mode: 'insensitive' } }, { userName: { contains: q, mode: 'insensitive' } }] } : {}),
        ...(before ? { at: { lt: new Date(before) } } : {}),
      },
      orderBy: { at: 'desc' }, take: 100,
    });
  });

  // ---- Users (admin) ----
  app.get('/api/users', async (req) => {
    requireRole(req, 'ADMIN');
    return (await prisma.user.findMany({ orderBy: { name: 'asc' } })).map((u) => ({ ...publicUser(u), active: u.active }));
  });

  app.post('/api/users', async (req) => {
    requireRole(req, 'ADMIN');
    const body = adminSchema.extend({ role: z.enum(['ADMIN', 'STAFF', 'READ_ONLY']) }).parse(req.body);
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw new HttpError(409, 'A user with that email already exists');
    const u = await prisma.user.create({ data: { name: body.name, email: body.email, role: body.role, passwordHash: await bcrypt.hash(body.password, 12) } });
    return publicUser(u);
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    requireRole(req, 'ADMIN');
    const body = z.object({
      name: z.string().min(1).optional(), role: z.enum(['ADMIN', 'STAFF', 'READ_ONLY']).optional(),
      active: z.boolean().optional(), password: z.string().min(10).optional(),
    }).parse(req.body);
    if (req.params.id === req.user!.id && (body.role && body.role !== 'ADMIN' || body.active === false))
      throw new HttpError(400, 'You cannot demote or deactivate your own account');
    const { password, ...rest } = body;
    const before = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!before) throw new HttpError(404, 'User not found');
    // Any change to credentials, role or access revokes that user's existing sessions.
    const revoke = !!password || (body.role !== undefined && body.role !== before.role) || body.active === false;
    const u = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}), ...(revoke ? { sessionVersion: { increment: 1 } } : {}) },
    });
    return { ...publicUser(u), active: u.active };
  });
}
