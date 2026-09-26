// Full-flow test against a real Postgres (TEST_DATABASE_URL) with mock Invoice Ninja + Docuseal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'node:http';
import { execSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const calls: { method: string; url: string; body: any }[] = [];
let invoiceStatus = '1';
function mockServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        calls.push({ method: req.method!, url: req.url!, body });
        const send = (o: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
        const u = req.url!;
        if (u.startsWith('/in/api/v1/companies')) return send({ data: [{ id: 'co1', settings: { name: 'Co One' } }, { id: 'co2', settings: { name: 'Co Two' } }] });
        if (u.startsWith('/in/api/v1/clients?')) return send({ data: [] });
        if (u === '/in/api/v1/clients') return send({ data: { id: 'inclient1' } });
        if (u === '/in/api/v1/invoices' && req.method === 'POST') return send({ data: { id: 'inv1', number: '0001', status_id: '1', invitations: [{ link: 'http://x/inv' }] } });
        if (u.startsWith('/in/api/v1/invoices/inv1')) return send({ data: { id: 'inv1', number: '0001', status_id: invoiceStatus, paid_to_date: invoiceStatus === '4' ? 1 : 0, invitations: [] } });
        if (u.startsWith('/ds/api/templates')) return send({ data: [{ id: 7, name: 'DS Template' }] });
        if (u === '/ds/api/submissions/html') return send({ id: 555, submitters: [{ id: 9, slug: 'abc', submission_id: 555 }] });
        if (u === '/ds/api/submissions' && req.method === 'POST') return send([{ id: 10, submission_id: 777, slug: 'mapped' }]);
        if (u.startsWith('/ds/api/submissions/555/documents')) return send({ documents: [{ name: 'signed', url: '/ds/file.pdf' }] });
        if (u === '/ds/file.pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.end('%PDF-1.4 fake'); }
        res.statusCode = 404; send({ message: 'nope ' + u });
      });
    });
    server.listen(0, () => resolve({ server, url: `http://127.0.0.1:${(server.address() as any).port}` }));
  });
}

run('end-to-end', () => {
  let app: FastifyInstance;
  let mock: { server: Server; url: string };
  let cookie = '';
  const api = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method: method as any, url, payload: payload as any, headers: { ...(cookie ? { cookie } : {}), ...headers } });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0] : set).split(';')[0];
    return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body };
  };
  const settle = () => new Promise((r) => setTimeout(r, 300));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.REDIS_URL = '';
    process.env.STORAGE_PATH = '/tmp/hirestation-test-storage';
    process.env.SESSION_SECRET ??= 'test-secret-test-secret-test-secret-123';
    // Fresh schema on the dedicated test database only.
    await prisma().$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma().$executeRawUnsafe('CREATE SCHEMA public');
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: 'ignore' });
    mock = await mockServer();
    app = await (await import('../app.js')).buildApp();
  });
  afterAll(async () => { await app?.close(); mock?.server.close(); await _prisma?.$disconnect(); });

  it('boots empty and forces setup', async () => {
    expect((await api('GET', '/api/setup/status')).body).toEqual({ needsSetup: true, hasAdmin: false });
    expect((await api('GET', '/api/equipment')).status).toBe(409);
    expect((await api('GET', '/api/settings')).body.setupRequired).toBe(true);
  });

  it('runs the setup wizard', async () => {
    expect((await api('POST', '/api/setup/admin', { name: 'Admin', email: 'a@example.com', password: 'longpassword1' })).status).toBe(200);
    expect((await api('POST', '/api/setup/admin', { name: 'X', email: 'x@example.com', password: 'longpassword1' })).status).toBe(409);
    const t = await api('POST', '/api/setup/test/invoice-ninja', { url: `${mock.url}/in`, token: 'tok' });
    expect(t.body.companies).toHaveLength(2);
    expect((await api('POST', '/api/setup/test/docuseal', { url: `${mock.url}/ds`, token: 'tok' })).body.templates[0].id).toBe(7);
    const bad = await api('POST', '/api/setup/finish', { identity: { abn: '123' } });
    expect(bad.status).toBe(400);
    const res = await api('POST', '/api/setup/finish', {
      identity: { legalName: 'Test Biz Pty Ltd', structure: 'COMPANY', abn: '51 824 753 556', acn: '000 000 019', addressLine1: '1 Test St', suburb: 'Testville', state: 'QLD', postcode: '4000', contactEmail: 'biz@example.com', contactPhone: '0400000000' },
      tax: { gstRegistered: true, gstRate: 10 },
      banking: { bankBsb: '123456', bankAccountNumber: '12345678', bankAccountName: 'Test Biz' },
      branding: { primaryColour: '#112233' },
      invoiceNinja: { invoiceNinjaUrl: `${mock.url}/in`, invoiceNinjaToken: 'tok', invoiceNinjaCompanyId: 'co2' },
      docuseal: { docusealUrl: `${mock.url}/ds`, docusealToken: 'tok' },
      locale: { timezone: 'Australia/Brisbane', currency: 'AUD', dateFormat: 'DD/MM/YYYY' },
    });
    expect(res.status).toBe(200);
    const s = await api('GET', '/api/settings');
    expect(s.body.bankBsb).toBe('123-456');
    expect(s.body.invoiceNinjaToken).toBeUndefined();
    expect(s.body.hasInvoiceNinjaToken).toBe(true);
  });

  let bookingId = '';
  let speakerId = '';
  it('books equipment with conflict detection', async () => {
    speakerId = (await api('POST', '/api/equipment', { name: 'Speaker', dailyRate: 100, stockQuantity: 2 })).body.id;
    const client = (await api('POST', '/api/clients', { type: 'BUSINESS', name: 'Client Co', email: 'c@example.com', abn: '51824753556' })).body;
    const base = { title: 'Gig', clientId: client.id, loadIn: '2030-01-01T08:00:00Z', loadOut: '2030-01-02T08:00:00Z', bondAmount: 200, status: 'CONFIRMED' };
    const b = await api('POST', '/api/bookings', { ...base, lineItems: [{ equipmentId: speakerId, qtyBooked: 2 }] });
    expect(b.status).toBe(200);
    bookingId = b.body.id;
    expect(b.body.quote.subtotal).toBe(20000);
    expect(b.body.quote.gstTotal).toBe(2000);
    expect(b.body.bondStatus).toBe('HELD');
    const b2 = await api('POST', '/api/bookings', { ...base, lineItems: [{ equipmentId: speakerId, qtyBooked: 1 }] });
    expect(b2.body.conflicts[0].shortBy).toBe(1);
  });

  it('sends a contract through Docuseal and tracks the webhook', async () => {
    const tpl = (await api('POST', '/api/templates', { name: 'Dry hire', content: '<p>{{client_name}} hires from {{business_name}} ABN {{business_abn}}</p>{{equipment_table}}' })).body;
    await api('PUT', `/api/templates/${tpl.id}`, { name: 'Dry hire', content: '<p>v2 {{client_name}}</p>' });
    expect((await api('GET', `/api/templates/${tpl.id}`)).body.versions).toHaveLength(2);
    const c = (await api('POST', `/api/bookings/${bookingId}/contracts`, { templateId: tpl.id, send: true })).body;
    expect(c.mergedContent).toContain('v2 Client Co');
    await settle();
    const htmlCall = calls.find((x) => x.url === '/ds/api/submissions/html' && x.body?.submitters);
    expect(htmlCall?.body.submitters[0].email).toBe('c@example.com');
    expect(htmlCall?.body.documents[0].html).toContain('signature-field');
    const settings = await prisma().businessProfile.findUnique({ where: { id: 1 } });
    const hook = `/api/webhooks/docuseal/${settings!.docusealWebhookKey}`;
    const evt = { event_type: 'form.completed', data: { id: 9, submission_id: 555 } };
    // Correct URL key but missing / wrong secret header is rejected.
    expect((await api('POST', hook, evt)).status).toBe(404);
    expect((await api('POST', hook, evt, { 'x-webhook-secret': 'nope' })).status).toBe(404);
    expect((await api('POST', hook, evt, { 'x-webhook-secret': settings!.webhookSecret! })).status).toBe(200);
    await settle();
    const b = (await api('GET', `/api/bookings/${bookingId}`)).body;
    expect(b.status).toBe('CONTRACT_SIGNED');
    expect(b.contracts[0].signedPdfPath).toBeTruthy();
    expect((await api('POST', '/api/webhooks/docuseal/wrong-key', {})).status).toBe(404);
  });

  it('invoices from the return record and syncs payment', async () => {
    const dep = (await api('GET', `/api/bookings/${bookingId}/departure`)).body;
    expect((await api('PUT', `/api/bookings/${bookingId}/departure?complete=true`, { lines: dep.lines.map((l: any) => ({ equipmentId: l.equipmentId, qtyOut: 2 })) })).status).toBe(200);
    const ret = await api('PUT', `/api/bookings/${bookingId}/return?complete=true`, { lateFee: 25, lines: [{ equipmentId: speakerId, qtyReturned: 1, condition: 'LOST', damageCharge: 300, damageNotes: 'missing' }] });
    expect(ret.status).toBe(200);
    await settle();
    const inv = calls.find((x) => x.url === '/in/api/v1/invoices');
    expect(inv?.body.client_id).toBe('inclient1');
    expect(inv?.body.line_items.map((l: any) => l.cost)).toEqual([100, 300, 25]);
    expect(inv?.body.line_items.every((l: any) => l.tax_rate1 === 10)).toBe(true);
    let b = (await api('GET', `/api/bookings/${bookingId}`)).body;
    expect(b.status).toBe('INVOICED');
    expect(Number(b.invoices[0].total)).toBe(577.5);
    invoiceStatus = '4';
    const settings = await prisma().businessProfile.findUnique({ where: { id: 1 } });
    await api('POST', `/api/webhooks/invoice-ninja/${settings!.invoiceNinjaWebhookKey}`, { id: 'inv1', entity_type: 'invoice' }, { 'x-webhook-secret': settings!.webhookSecret! });
    await settle();
    b = (await api('GET', `/api/bookings/${bookingId}`)).body;
    expect(b.status).toBe('PAID');
  });

  it('accepts HMAC-signed Docuseal webhooks without the shared header', async () => {
    const hmac = 'whsec_' + 'x'.repeat(32);
    expect((await api('PUT', '/api/settings/docuseal', { docusealUrl: `${mock.url}/ds`, docusealWebhookHmacSecret: hmac })).status).toBe(200);
    const s = await prisma().businessProfile.findUnique({ where: { id: 1 } });
    const body = JSON.stringify({ event_type: 'form.viewed', data: { id: 9, submission_id: 555 } });
    const ts = Math.floor(Date.now() / 1000);
    const { createHmac } = await import('node:crypto');
    const sig = `${ts}.${createHmac('sha256', hmac).update(`${ts}.${body}`).digest('hex')}`;
    const url = `/api/webhooks/docuseal/${s!.docusealWebhookKey}`;
    const send = (signature: string, payload = body) => app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json', 'x-docuseal-signature': signature } });
    expect((await send(sig)).statusCode).toBe(200);
    expect((await send(sig, body.replace('viewed', 'declined'))).statusCode).toBe(404); // tampered
    expect((await api('GET', '/api/settings')).body.hasDocusealWebhookHmacSecret).toBe(true);
    expect(JSON.stringify((await api('GET', '/api/settings')).body)).not.toContain(hmac);
    await settle();
  });

  it('requires mapped templates on the Docuseal free edition and locks prefilled values', async () => {
    expect((await api('PUT', '/api/settings/docuseal', { docusealUrl: `${mock.url}/ds`, docusealEdition: 'free' })).status).toBe(200);
    const tpl = (await api('POST', '/api/templates', { name: 'Unmapped', content: '<p>{{client_name}}</p>' })).body;
    const refused = await api('POST', `/api/bookings/${bookingId}/contracts`, { templateId: tpl.id, send: true });
    expect(refused.status).toBe(412);
    expect(refused.body.error).toMatch(/free edition/);
    await api('PUT', `/api/templates/${tpl.id}`, { name: 'Unmapped', docusealTemplateId: '42' });
    const ok = await api('POST', `/api/bookings/${bookingId}/contracts`, { templateId: tpl.id, send: true });
    expect(ok.status).toBe(200);
    await settle();
    const call = calls.find((x) => x.url === '/ds/api/submissions' && x.method === 'POST');
    expect(call?.body.template_id).toBe(42);
    const sub = call?.body.submitters[0];
    expect(sub.email).toBe('c@example.com');
    expect(sub.values.client_name).toBe('Client Co');
    expect(sub.values.equipment_list).toContain('Speaker');
    expect(sub.readonly_fields).toEqual(Object.keys(sub.values));
    await api('PUT', '/api/settings/docuseal', { docusealUrl: `${mock.url}/ds`, docusealEdition: 'pro' });
  });

  it('records webhook events and allows replay', async () => {
    const events = (await api('GET', '/api/webhook-events')).body;
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e: any) => e.processed)).toBe(true);
    const r = await api('POST', `/api/webhook-events/${events[0].id}/replay`);
    expect(r.body.queued).toBe(true);
    await settle();
    expect((await api('GET', '/api/webhook-events')).body.find((e: any) => e.id === events[0].id).attempts).toBe(2);
  });

  it('writes an audit trail without secrets', async () => {
    await api('PUT', '/api/settings/docuseal', { docusealUrl: `${mock.url}/ds`, docusealToken: 'new-secret-token' });
    const log = (await api('GET', '/api/audit')).body;
    const entry = log.find((l: any) => l.action === 'PUT /api/settings/:section');
    expect(entry.userName).toBe('Admin');
    expect(entry.detail.docusealToken).toBe('[redacted]');
    expect(JSON.stringify(log)).not.toContain('new-secret-token');
    expect(log.some((l: any) => l.action === 'POST /api/bookings/:id/contracts' && l.entity === 'bookings')).toBe(true);
    expect(log.some((l: any) => l.action === 'setup.finished')).toBe(true);
  });

  it('refuses cross-origin mutations and sets security headers', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/clients', payload: { type: 'INDIVIDUAL', name: 'x' }, headers: { cookie, origin: 'https://evil.example', host: 'localhost' } });
    expect(res.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/clients', payload: { type: 'INDIVIDUAL', name: 'x' }, headers: { cookie, origin: 'http://localhost', host: 'localhost' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('revokes other sessions on password change and sign-out-everywhere', async () => {
    const other = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@example.com', password: 'longpassword1' } });
    const otherCookie = String(other.headers['set-cookie']).split(';')[0];
    const me = () => app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: otherCookie } });
    expect((await me()).statusCode).toBe(200);
    expect((await api('POST', '/api/auth/password', { current: 'longpassword1', next: 'longpassword2' })).status).toBe(200);
    expect((await me()).statusCode).toBe(401); // other device signed out
    expect((await api('GET', '/api/auth/me')).status).toBe(200); // this session re-issued
    const before = cookie;
    await api('POST', '/api/auth/logout-all');
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: before } })).statusCode).toBe(401);
    expect((await api('GET', '/api/auth/me')).status).toBe(200);
  });

  it('throttles repeated failed sign-ins', async () => {
    const attempt = (password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@example.com', password }, remoteAddress: '10.9.9.9' });
    for (let i = 0; i < 5; i++) expect((await attempt('wrong-password')).statusCode).toBe(401);
    const blocked = await attempt('longpassword2'); // even the right password is refused while locked
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeTruthy();
    const log = (await api('GET', '/api/audit?q=auth.login')).body;
    expect(log.some((l: any) => l.action === 'auth.login_failed')).toBe(true);
    expect(log.some((l: any) => l.action === 'auth.login_throttled')).toBe(true);
  });

  it('enforces read-only role', async () => {
    const ro = (await api('POST', '/api/users', { name: 'RO', email: 'ro@example.com', password: 'longpassword1', role: 'READ_ONLY' })).body;
    const adminCookie = cookie;
    cookie = '';
    await api('POST', '/api/auth/login', { email: 'ro@example.com', password: 'longpassword1' });
    expect((await api('GET', '/api/equipment')).status).toBe(200);
    expect((await api('POST', '/api/equipment', { name: 'x', dailyRate: 1 })).status).toBe(403);
    expect((await api('GET', '/api/audit')).status).toBe(403);
    // An admin disabling the account ends its session immediately.
    const roCookie = cookie;
    cookie = adminCookie;
    await api('PATCH', `/api/users/${ro.id}`, { active: false });
    cookie = roCookie;
    expect((await api('GET', '/api/equipment')).status).toBe(401);
  });
});

import { PrismaClient } from "@prisma/client";
let _prisma: PrismaClient | undefined;
function prisma() { return (_prisma ??= new PrismaClient({ datasourceUrl: TEST_DB })); }
