import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError, endSession, startSession } from '../lib/auth.js';
import { loginByAccount, loginByIp } from '../lib/rateLimit.js';
import { audit } from '../lib/audit.js';

export const publicUser = (u: { id: string; name: string; email: string; role: string }) =>
  ({ id: u.id, name: u.name, email: u.email, role: u.role });

// Precomputed hash so unknown emails still cost one bcrypt comparison (uniform timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const email = body.email.toLowerCase().trim();
    const wait = Math.max(loginByAccount.blockedFor(email), loginByIp.blockedFor(req.ip));
    if (wait) {
      reply.header('Retry-After', String(wait));
      await audit(req, 'auth.login_throttled', { detail: { email } });
      throw new HttpError(429, `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
    }
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) {
      loginByAccount.hit(email);
      loginByIp.hit(req.ip);
      await audit(req, 'auth.login_failed', { user: null, detail: { email } });
      throw new HttpError(401, 'Incorrect email or password');
    }
    loginByAccount.reset(email);
    startSession(reply, user);
    await audit(req, 'auth.login', { user });
    return publicUser(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.user) await audit(req, 'auth.logout');
    endSession(reply);
    return { ok: true };
  });

  // Revoke every session for this account (including other devices), then re-issue this one.
  app.post('/api/auth/logout-all', async (req, reply) => {
    if (!req.user) throw new HttpError(401, 'Not signed in');
    const u = await prisma.user.update({ where: { id: req.user.id }, data: { sessionVersion: { increment: 1 } } });
    startSession(reply, u);
    await audit(req, 'auth.logout_all');
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.user) throw new HttpError(401, 'Not signed in');
    const staff = await prisma.staff.findUnique({ where: { userId: req.user.id } });
    return { ...publicUser(req.user), staffId: staff?.id ?? null };
  });

  app.post('/api/auth/password', async (req, reply) => {
    const body = z.object({ current: z.string(), next: z.string().min(10, 'Password must be at least 10 characters') }).parse(req.body);
    if (!(await bcrypt.compare(body.current, req.user!.passwordHash))) throw new HttpError(400, 'Current password is incorrect');
    // Changing the password signs out all other sessions; this one continues.
    const u = await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash: await bcrypt.hash(body.next, 12), sessionVersion: { increment: 1 } },
    });
    startSession(reply, u);
    await audit(req, 'auth.password_changed');
    return { ok: true };
  });
}
