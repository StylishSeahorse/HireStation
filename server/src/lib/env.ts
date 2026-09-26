import { existsSync } from 'node:fs';

// Local development convenience; in Docker the values come from the compose environment.
if (existsSync('.env')) process.loadEnvFile('.env');

// Infrastructure-only configuration. Business data never lives here.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  redisUrl: process.env.REDIS_URL ?? '',
  storagePath: process.env.STORAGE_PATH ?? './storage',
  port: Number(process.env.PORT ?? 3000),
  publicUrl: process.env.PUBLIC_URL ?? '',
  webDist: process.env.WEB_DIST ?? '',
  // Which hops may set X-Forwarded-* (client IP drives login throttling). Defaults to
  // loopback + private networks, i.e. a reverse proxy on the same host or Docker network.
  trustProxy: process.env.TRUST_PROXY ?? 'loopback,linklocal,uniquelocal',
  production: process.env.NODE_ENV === 'production',
};

if (env.sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
