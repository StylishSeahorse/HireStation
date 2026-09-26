// Small in-memory fixed-window limiter. The app runs as a single instance, so
// process memory is an adequate store; counts reset on restart.
interface Bucket { count: number; resetAt: number }

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private max: number, private windowMs: number) {}

  /** Seconds until retry is allowed, or 0 if the key is currently under the limit. */
  blockedFor(key: string, now = Date.now()): number {
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) return 0;
    return b.count >= this.max ? Math.ceil((b.resetAt - now) / 1000) : 0;
  }

  hit(key: string, now = Date.now()) {
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    else b.count++;
    if (this.buckets.size > 10_000) this.sweep(now);
  }

  reset(key: string) { this.buckets.delete(key); }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}

// Failed sign-ins: 5 per account per 15 min, and 20 per IP per 15 min (slows credential stuffing).
export const loginByAccount = new RateLimiter(5, 15 * 60_000);
export const loginByIp = new RateLimiter(20, 15 * 60_000);
// Integration "test connection" / ABN lookup calls make outbound requests; keep them modest.
export const outboundTests = new RateLimiter(30, 10 * 60_000);
