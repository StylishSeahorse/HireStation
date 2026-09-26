import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../lib/env.js';

export const QUEUE_NAME = 'nv-hire';

export type JobName =
  | 'invoice.generate'
  | 'contract.send'
  | 'contract.fetchSigned'
  | 'webhook.invoiceNinja'
  | 'reminders.scan';

let queue: Queue | null = null;
export function connection() {
  return new Redis(env.redisUrl, { maxRetriesPerRequest: null });
}

function getQueue(): Queue | null {
  if (!env.redisUrl) return null;
  queue ??= new Queue(QUEUE_NAME, { connection: connection() });
  return queue;
}

// When Redis isn't configured (tests / local dev) jobs run inline so nothing is silently dropped.
type Handler = (data: Record<string, unknown>) => Promise<unknown>;
const inline = new Map<string, Handler>();
export function registerInline(name: JobName, fn: Handler) { inline.set(name, fn); }

export async function enqueue(name: JobName, data: Record<string, unknown>, opts: { delay?: number; jobId?: string } = {}) {
  const q = getQueue();
  if (q) {
    await q.add(name, data, { attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 1000, removeOnFail: 5000, ...opts });
    return;
  }
  const fn = inline.get(name);
  if (fn) setImmediate(() => fn(data).catch((e) => console.error(`[inline job ${name}]`, e)));
}
