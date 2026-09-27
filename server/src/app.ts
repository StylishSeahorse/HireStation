import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import './lib/settingsSchema.js'; // registers the global zod error map
import { env } from './lib/env.js';
import { prisma } from './lib/db.js';
import { HttpError, guardMutation, loadUser } from './lib/auth.js';
import { IntegrationError } from './services/http.js';
import { audit, entityOf } from './lib/audit.js';
import { authRoutes } from './routes/auth.js';
import { setupRoutes } from './routes/setup.js';
import { settingsRoutes } from './routes/settings.js';
import { equipmentRoutes } from './routes/equipment.js';
import { clientRoutes } from './routes/clients.js';
import { staffRoutes } from './routes/staff.js';
import { bookingRoutes } from './routes/bookings.js';
import { inventoryRoutes } from './routes/inventory.js';
import { contractRoutes } from './routes/contracts.js';
import { invoiceRoutes } from './routes/invoices.js';
import { webhookRoutes } from './routes/webhooks.js';
import { miscRoutes } from './routes/misc.js';
import { registerInline, JobName } from './jobs/queue.js';
import { handlers } from './jobs/handlers.js';

// Routes reachable before the business profile exists.
const PRE_SETUP = ['/api/setup', '/api/auth', '/api/health'];
// Routes reachable without a session once setup is complete.
const PUBLIC = ['/api/auth/login', '/api/setup/status', '/api/health', '/api/webhooks/', '/api/branding/'];

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 5 * 1024 * 1024, trustProxy: env.trustProxy });
  await app.register(cookie, { secret: env.sessionSecret });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } });

  // Without Redis (local dev/tests) background jobs run in-process.
  if (!env.redisUrl) for (const [name, fn] of Object.entries(handlers)) registerInline(name as JobName, fn);

  app.decorateRequest('user', null);
  app.decorateRequest('rawBody', undefined);

  // Keep the exact request body so webhook signatures (HMAC over the raw bytes) can be verified.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = body as string;
    req.rawBody = text;
    if (!text) return done(null, undefined);
    try { done(null, JSON.parse(text)); } catch { done(new HttpError(400, 'Invalid JSON body'), undefined); }
  });

  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  // POST endpoints that only compute/preview and change nothing: not worth an audit entry.
  const READ_ONLY_POSTS = new Set(['/api/templates/preview', '/api/bookings/check', '/api/setup/validate/:section', '/api/setup/abn-lookup', '/api/setup/test/invoice-ninja', '/api/setup/test/docuseal']);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const path = req.url.split('?')[0];
    // CSRF defence in depth (cookies are already SameSite=Lax): browsers send Origin on
    // cross-site requests, so a mutating request from another origin is refused.
    if (MUTATING.has(req.method) && req.headers.origin && !path.startsWith('/api/webhooks/')) {
      let originHost = '';
      try { originHost = new URL(req.headers.origin).host; } catch { /* malformed */ }
      // req.host honours X-Forwarded-Host only when it comes from a trusted proxy.
      if (originHost !== req.host) throw new HttpError(403, 'Cross-origin request refused');
    }
    req.user = await loadUser(req);
    const profile = await prisma.businessProfile.findUnique({ where: { id: 1 }, select: { id: true } });
    if (!profile && !PRE_SETUP.some((p) => path.startsWith(p))) {
      throw new HttpError(409, 'Setup required', { setupRequired: true });
    }
    if (PUBLIC.some((p) => path.startsWith(p))) return;
    if (path.startsWith('/api/setup') && !profile) return; // setup routes do their own checks
    if (!req.user) throw new HttpError(401, 'Not signed in');
    guardMutation(req);
  });

  // Record every state-changing API call (auth, setup and webhooks write their own richer entries).
  app.addHook('onResponse', async (req, reply) => {
    if (!MUTATING.has(req.method) || !req.url.startsWith('/api/')) return;
    const route = req.routeOptions.url;
    if (!route || READ_ONLY_POSTS.has(route) || /^\/api\/(auth|webhooks)\//.test(route) || route === '/api/setup/admin' || route === '/api/setup/finish') return;
    if (!req.user) return; // unauthenticated attempts are rejected before doing anything
    const { entity, entityId } = entityOf(route, req.params as Record<string, string>);
    let detail: unknown;
    if (req.body && typeof req.body === 'object' && !req.isMultipart()) {
      const json = JSON.stringify(req.body);
      detail = json.length <= 4000 ? req.body : { truncated: true, keys: Object.keys(req.body as object) };
    }
    await audit(req, `${req.method} ${route}`, { entity, entityId, status: reply.statusCode, detail });
  });

  // Baseline security headers for API and SPA responses.
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (!reply.hasHeader('X-Frame-Options')) reply.header('X-Frame-Options', 'SAMEORIGIN');
    if (req.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=15552000');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html') && !reply.hasHeader('Content-Security-Policy')) {
      reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'");
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Validation failed', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message, ...(err.details as object) });
    if (err instanceof IntegrationError) return reply.status(502).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? 'Internal server error' : (err as Error).message });
  });

  await app.register(authRoutes);
  await app.register(setupRoutes);
  await app.register(settingsRoutes);
  await app.register(equipmentRoutes);
  await app.register(clientRoutes);
  await app.register(staffRoutes);
  await app.register(bookingRoutes);
  await app.register(inventoryRoutes);
  await app.register(contractRoutes);
  await app.register(invoiceRoutes);
  await app.register(webhookRoutes);
  await app.register(miscRoutes);

  // Serve the built frontend (single container deployment) with SPA fallback.
  const webDist = resolve(env.webDist || '../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
