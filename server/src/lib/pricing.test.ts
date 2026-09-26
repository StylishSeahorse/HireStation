import { describe, it, expect } from 'vitest';
import { computeTotals, usageLines } from './pricing.js';
import { isValidAbn, isValidAcn, isValidBsb } from './au.js';
import { hireDays } from './dates.js';
import { RateLimiter } from './rateLimit.js';
import { redact } from './audit.js';
import { createHmac } from 'node:crypto';
import { verifyDocusealSignature } from '../routes/webhooks.js';

describe('AU validators', () => {
  it('validates ABN checksum', () => {
    expect(isValidAbn('51 824 753 556')).toBe(true); // ATO's published example ABN
    expect(isValidAbn('51 824 753 557')).toBe(false);
    expect(isValidAbn('123')).toBe(false);
  });
  it('validates ACN checksum', () => {
    expect(isValidAcn('000 000 019')).toBe(true);
    expect(isValidAcn('000 000 018')).toBe(false);
  });
  it('validates BSB', () => {
    expect(isValidBsb('123-456')).toBe(true);
    expect(isValidBsb('123456')).toBe(true);
    expect(isValidBsb('12-3456')).toBe(false);
  });
});

describe('pricing', () => {
  const tax = { gstRegistered: true, gstRate: 10 };
  const equipment = [
    { id: 'a', name: 'Speaker', gstTaxable: true },
    { id: 'b', name: 'Exempt thing', gstTaxable: false },
  ];

  it('invoices from usage, adds damage/late fees and excludes held bonds', () => {
    const lines = usageLines({
      equipment,
      returnLines: [
        { equipmentId: 'a', qtyOut: 2, qtyReturned: 1, dailyRate: '100', days: '2', damageCharge: '50', damageNotes: 'cone torn' },
        { equipmentId: 'b', qtyOut: 1, qtyReturned: 1, dailyRate: '20', days: '2', damageCharge: 0 },
      ],
      lateFee: '30', discountPercent: 0, bondForfeited: 0,
    }, tax);
    const t = computeTotals(lines, tax);
    expect(lines.map((l) => l.kind)).toEqual(['HIRE', 'HIRE', 'DAMAGE', 'LATE_FEE']);
    expect(t.subtotal).toBe(40000 + 4000 + 5000 + 3000);
    expect(t.gstTotal).toBe(4000 + 500 + 300);
    expect(t.total).toBe(t.subtotal + t.gstTotal);
  });

  it('treats a forfeited bond as GST-inclusive consideration', () => {
    const lines = usageLines({ equipment, returnLines: [], lateFee: 0, discountPercent: 0, bondForfeited: '110' }, tax);
    const t = computeTotals(lines, tax);
    expect(t.subtotal).toBe(10000);
    expect(t.gstTotal).toBe(1000);
  });

  it('uses the configured rate and charges no GST when unregistered', () => {
    const lines = usageLines({ equipment, returnLines: [{ equipmentId: 'a', qtyOut: 1, qtyReturned: 1, dailyRate: 100, days: 1, damageCharge: 0 }], lateFee: 0, discountPercent: 0, bondForfeited: 0 }, tax);
    expect(computeTotals(lines, { gstRegistered: true, gstRate: 15 }).gstTotal).toBe(1500);
    expect(computeTotals(lines, { gstRegistered: false, gstRate: 10 }).gstTotal).toBe(0);
  });

  it('counts hire days', () => {
    expect(hireDays(new Date('2026-01-01T08:00Z'), new Date('2026-01-01T20:00Z'))).toBe(1);
    expect(hireDays(new Date('2026-01-01T08:00Z'), new Date('2026-01-03T09:00Z'))).toBe(3);
  });
});

describe('rate limiter', () => {
  it('blocks after the limit until the window passes', () => {
    const rl = new RateLimiter(2, 1000);
    rl.hit('k', 0); expect(rl.blockedFor('k', 0)).toBe(0);
    rl.hit('k', 0); expect(rl.blockedFor('k', 10)).toBe(1);
    expect(rl.blockedFor('k', 1000)).toBe(0);
    rl.hit('k', 1000); expect(rl.blockedFor('k', 1000)).toBe(0);
  });
});

describe('audit redaction', () => {
  it('redacts secret-looking keys at any depth', () => {
    expect(redact({ name: 'a', invoiceNinjaToken: 't', nested: { password: 'p', ok: 1 } })).toEqual({ name: 'a', invoiceNinjaToken: '[redacted]', nested: { password: '[redacted]', ok: 1 } });
  });
});

describe('Docuseal webhook signature', () => {
  const secret = 'whsec_test';
  const body = '{"event_type":"form.completed"}';
  const sign = (ts: number, b = body) => `${ts}.${createHmac('sha256', secret).update(`${ts}.${b}`).digest('hex')}`;
  const now = 1_790_000_000_000;
  it('accepts a fresh valid signature', () => {
    expect(verifyDocusealSignature(secret, body, sign(now / 1000), now)).toBe(true);
  });
  it('rejects a tampered body, wrong secret, stale timestamp or garbage', () => {
    expect(verifyDocusealSignature(secret, body + ' ', sign(now / 1000), now)).toBe(false);
    expect(verifyDocusealSignature('whsec_other', body, sign(now / 1000), now)).toBe(false);
    expect(verifyDocusealSignature(secret, body, sign(now / 1000 - 301), now)).toBe(false);
    expect(verifyDocusealSignature(secret, body, 'nonsense', now)).toBe(false);
    expect(verifyDocusealSignature(secret, body, undefined, now)).toBe(false);
  });
});
