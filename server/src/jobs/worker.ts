import { Queue, Worker } from 'bullmq';
import { QUEUE_NAME, connection } from './queue.js';
import { handlers } from './handlers.js';
import { env } from '../lib/env.js';

if (!env.redisUrl) throw new Error('REDIS_URL is required to run the worker');

const worker = new Worker(QUEUE_NAME, async (job) => {
  const fn = handlers[job.name as keyof typeof handlers];
  if (!fn) throw new Error(`Unknown job ${job.name}`);
  return fn(job.data);
}, { connection: connection(), concurrency: 4 });

worker.on('failed', (job, err) => console.error(`[job ${job?.name}#${job?.id}] failed:`, err.message));
worker.on('completed', (job) => console.log(`[job ${job.name}#${job.id}] done`));

// Hourly reminder scan.
const q = new Queue(QUEUE_NAME, { connection: connection() });
await q.upsertJobScheduler('reminders', { every: 60 * 60 * 1000 }, { name: 'reminders.scan', data: {} });
console.log('Worker started');
