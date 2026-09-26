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
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 5 * 1024 * 1024, trustProxy: true });
  await app.register(cookie, { secret: env.sessionSecret });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } });

  // Without Redis (local dev/tests) background jobs run in-process.
  if (!env.redisUrl) for (const [name, fn] of Object.entries(handlers)) registerInline(name as JobName, fn);

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const path = req.url.split('?')[0];
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
