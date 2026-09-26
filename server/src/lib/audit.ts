import type { FastifyRequest } from 'fastify';
import { prisma } from './db.js';

// Never persist these keys in audit detail.
const SECRET_KEYS = /token|password|secret|guid|key/i;

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(x, depth + 1)]));
}

export async function audit(req: FastifyRequest | null, action: string, extra: { entity?: string; entityId?: string; status?: number; detail?: unknown; user?: { id: string; name: string } | null } = {}) {
  const user = extra.user !== undefined ? extra.user : req?.user;
  try {
    await prisma.auditLog.create({
      data: {
        action, entity: extra.entity, entityId: extra.entityId, status: extra.status,
        userId: user?.id, userName: user?.name, ip: req?.ip,
        detail: extra.detail === undefined ? undefined : (redact(extra.detail) as object),
      },
    });
  } catch (e) {
    req?.log.warn({ err: e }, 'audit write failed'); // auditing must never break the request
  }
}

/** Derive entity type/id from a route like /api/bookings/:id/status. */
export function entityOf(routeUrl: string | undefined, params: Record<string, string> | undefined) {
  const parts = (routeUrl ?? '').replace(/^\/api\//, '').split('/');
  return { entity: parts[0] || undefined, entityId: params?.id ?? params?.unitId ?? undefined };
}
