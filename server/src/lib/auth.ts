import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import type { Role, User } from '@prisma/client';

export const SESSION_COOKIE = 'hs_session';
const MAX_AGE_S = 60 * 60 * 24 * 14;

declare module 'fastify' {
  interface FastifyRequest { user: User | null; rawBody?: string }
}

export function startSession(reply: FastifyReply, user: { id: string; sessionVersion: number }) {
  const exp = Date.now() + MAX_AGE_S * 1000;
  reply.setCookie(SESSION_COOKIE, `${user.id}.${user.sessionVersion}.${exp}`, {
    signed: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE_S,
    secure: process.env.NODE_ENV === 'production',
  });
}

export function endSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function loadUser(req: FastifyRequest): Promise<User | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const { valid, value } = req.unsignCookie(raw);
  if (!valid || !value) return null;
  const [id, version, exp] = value.split('.');
  if (!id || !exp || Number(exp) < Date.now()) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  // A bumped sessionVersion (password change, deactivation, "sign out everywhere") revokes old cookies.
  if (!user?.active || user.sessionVersion !== Number(version)) return null;
  return user;
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) { super(message); }
}

const RANK: Record<Role, number> = { READ_ONLY: 0, STAFF: 1, ADMIN: 2 };

export function requireRole(req: FastifyRequest, role: Role) {
  if (!req.user) throw new HttpError(401, 'Not signed in');
  if (RANK[req.user.role] < RANK[role]) throw new HttpError(403, 'You do not have permission to do that');
}

/** Read-only users may GET; anything that mutates needs STAFF unless a route asks for more. */
export function guardMutation(req: FastifyRequest) {
  if (req.method !== 'GET' && req.method !== 'HEAD') requireRole(req, 'STAFF');
}
