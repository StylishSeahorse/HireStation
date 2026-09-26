import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { HttpError, endSession, startSession } from '../lib/auth.js';

export const publicUser = (u: { id: string; name: string; email: string; role: string }) =>
  ({ id: u.id, name: u.name, email: u.email, role: u.role });

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase().trim() } });
    // Always run a hash comparison to keep timing uniform.
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
    if (!user || !ok || !user.active) throw new HttpError(401, 'Incorrect email or password');
    startSession(reply, user.id);
    return publicUser(user);
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    endSession(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.user) throw new HttpError(401, 'Not signed in');
    const staff = await prisma.staff.findUnique({ where: { userId: req.user.id } });
    return { ...publicUser(req.user), staffId: staff?.id ?? null };
  });
}
