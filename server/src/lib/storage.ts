import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, resolve, extname, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from './env.js';

const root = resolve(env.storagePath);

/** Save bytes under storage/<folder>/ and return the relative path stored in the DB. */
export async function saveFile(folder: string, originalName: string, data: Buffer): Promise<string> {
  const ext = extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  const rel = join(folder, `${randomUUID()}${ext}`);
  await mkdir(join(root, folder), { recursive: true });
  await writeFile(join(root, rel), data);
  return rel;
}

export function absPath(rel: string): string {
  const p = resolve(root, normalize(rel));
  if (!p.startsWith(root)) throw new Error('Invalid storage path');
  return p;
}

export const fileExists = (rel: string) => existsSync(absPath(rel));
export const openFile = (rel: string) => createReadStream(absPath(rel));
export const readStored = (rel: string) => readFile(absPath(rel));
export const removeFile = (rel: string) => unlink(absPath(rel)).catch(() => undefined);

export const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.pdf': 'application/pdf',
};
export const mimeOf = (rel: string) => MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream';
