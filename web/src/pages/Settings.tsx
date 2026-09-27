import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useMutate } from '@/lib/useMutate';
import { useMe, useSettings } from '@/lib/hooks';
import { useFormat } from '@/lib/format';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { BankingForm, BrandingForm, clean, Draft, DocusealForm, IdentityForm, InvoiceNinjaForm, LocaleForm, TaxForm } from '@/components/SettingsForms';

const SECTIONS = [
  ['identity', 'Business identity'], ['tax', 'Tax'], ['banking', 'Banking'], ['branding', 'Branding'],
  ['invoiceNinja', 'Invoice Ninja'], ['docuseal', 'Docuseal'], ['locale', 'Locale & defaults'], ['users', 'Users'],
  ['webhooks', 'Webhook log'], ['audit', 'Audit log'], ['account', 'My account'],
] as const;

const FIELDS: Record<string, string[]> = {
  identity: ['legalName', 'tradingName', 'structure', 'abn', 'acn', 'addressLine1', 'addressLine2', 'suburb', 'state', 'postcode', 'contactEmail', 'contactPhone', 'signatoryName', 'signatoryTitle'],
  tax: ['gstRegistered', 'gstRate'],
  banking: ['bankBsb', 'bankAccountNumber', 'bankAccountName'],
  branding: ['primaryColour', 'accentColour', 'documentFooter'],
  invoiceNinja: ['invoiceNinjaUrl', 'invoiceNinjaCompanyId'],
  docuseal: ['docusealUrl', 'docusealEdition'],
  locale: ['timezone', 'currency', 'dateFormat', 'holidayRegion', 'contractReminderDays'],
};

export default function SettingsPage() {
  const { data: me } = useMe();
  const admin = me?.role === 'ADMIN';
  const visible = SECTIONS.filter(([k]) => admin || k === 'account');
  return (
    <>
      <PageHeader title="Settings" subtitle={admin ? 'The same details captured in the setup wizard.' : undefined} />
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {visible.map(([k, l]) => <NavLink key={k} to={`/settings/${k}`} className={({ isActive }) => clsx('whitespace-nowrap rounded px-3 py-2 text-sm', isActive ? 'bg-white font-medium shadow-sm' : 'text-slate-600 hover:bg-white/60')}>{l}</NavLink>)}
        </nav>
        <Routes>
          <Route index element={<Navigate to={admin ? 'identity' : 'account'} replace />} />
          {admin && FIELDS && Object.keys(FIELDS).map((k) => <Route key={k} path={k} element={<Section name={k} />} />)}
          {admin && <Route path="users" element={<Users />} />}
          {admin && <Route path="webhooks" element={<WebhookLog />} />}
          {admin && <Route path="audit" element={<AuditLog />} />}
          <Route path="account" element={<Account />} />
          <Route path="*" element={<Navigate to="account" replace />} />
        </Routes>
      </div>
    </>
  );
}

function Section({ name }: { name: string }) {
  const { data: s, isLoading } = useSettings();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => { if (s) setDraft(Object.fromEntries(FIELDS[name].map((k) => [k, s[k] ?? '']))); }, [s, name]);
  const save = useMutate(() => api(`/settings/${name}`, { method: 'PUT', body: normalise(name, clean(draft)) }), [['settings'], ['branding']]);
  const logo = async (f: File) => { const form = new FormData(); form.append('file', f); await api('/settings/logo', { form }); await qc.invalidateQueries({ queryKey: ['settings'] }); };
  const removeLogo = async () => { await api('/settings/logo', { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['settings'] }); };
  if (isLoading || !s) return <Spinner />;
  const title = SECTIONS.find(([k]) => k === name)![1];
  const props = { value: draft, onChange: setDraft, existing: true };
  return (
    <div className="space-y-6">
      <Card title={title}>
        {name === 'identity' && <IdentityForm {...props} />}
        {name === 'tax' && <TaxForm {...props} />}
        {name === 'banking' && <BankingForm {...props} />}
        {name === 'branding' && <BrandingForm {...props} logoUrl={s.logoUrl} onLogo={logo} onRemoveLogo={removeLogo} />}
        {name === 'invoiceNinja' && <InvoiceNinjaForm {...props} hasToken={s.hasInvoiceNinjaToken} />}
        {name === 'docuseal' && <DocusealForm {...props} hasToken={s.hasDocusealToken} hasHmacSecret={s.hasDocusealWebhookHmacSecret} />}
        {name === 'locale' && <LocaleForm {...props} />}
        <div className="mt-4 flex items-center gap-3 border-t pt-4">
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save</Button>
          {save.isSuccess && <span className="text-sm text-emerald-700">Saved</span>}
        </div>
        {save.error && <div className="mt-2"><Alert>{save.error}</Alert></div>}
      </Card>
      {name === 'invoiceNinja' && s.hasInvoiceNinjaToken && <ClientSync />}
      {(name === 'invoiceNinja' || name === 'docuseal') && <Webhooks which={name} />}
    </div>
  );
}

function normalise(name: string, d: Draft) {
  if (name === 'tax') return { ...d, gstRate: Number(d.gstRate || 0) };
  if (name === 'branding') return { primaryColour: d.primaryColour || null, accentColour: d.accentColour || null, documentFooter: d.documentFooter || null };
  return d;
}

function Webhooks({ which }: { which: 'invoiceNinja' | 'docuseal' }) {
  const { data: s } = useSettings();
  const register = useMutate(() => api('/settings/invoice-ninja/register-webhooks', { method: 'POST' }), []);
  const rotate = useMutate(() => api(`/settings/webhook-key/${which === 'docuseal' ? 'docuseal' : 'invoice-ninja'}`, { method: 'POST' }), [['settings']]);
  const rotateSecret = useMutate(() => api('/settings/webhook-secret', { method: 'POST' }), [['settings']]);
  const [showSecret, setShowSecret] = useState(false);
  const url = s?.webhookUrls?.[which];
  const internalUrl = s?.webhookUrls?.internal?.[which];
  return (
    <Card title="Webhook (status sync)">
      <p className="mb-2 text-sm text-slate-500">
        {which === 'docuseal'
          ? 'In Docuseal → Settings → Webhooks, add this URL and enable form.viewed, form.completed and form.declined. Then either paste Docuseal’s signing secret into the form above (recommended — signatures are verified), or add the header below as a custom secret.'
          : 'Invoice Ninja calls this URL when invoices change or payments arrive, so booking statuses update without polling. “Register webhooks” sets the URL and secret header for you. Invoice Ninja only accepts a URL whose hostname resolves to a public IP, so PUBLIC_URL must be HireStation’s public address.'}
      </p>
      <div className="space-y-2 text-xs">
        <div><span className="text-slate-500">URL</span><code className="block break-all rounded bg-slate-100 p-2">{url ?? '—'}</code></div>
        {internalUrl && which === 'docuseal' && (
          <div><span className="text-slate-500">Internal URL (Docuseal running in this compose stack; no reverse-proxy round trip)</span><code className="block break-all rounded bg-slate-100 p-2">{internalUrl}</code></div>
        )}
        <div>
          <span className="text-slate-500">Required header</span>
          <code className="block break-all rounded bg-slate-100 p-2">{s?.webhookSecretHeader}: {showSecret ? s?.webhookSecret : '••••••••••••••••'}</code>
          <div className="mt-1 flex gap-2">
            <button className="text-brand-accent" onClick={() => setShowSecret(!showSecret)}>{showSecret ? 'Hide' : 'Show'}</button>
            <button className="text-brand-accent" onClick={() => navigator.clipboard?.writeText(s?.webhookSecret ?? '')}>Copy secret</button>
          </div>
        </div>
        <p className="text-slate-500">Requests without both the URL key and this header are rejected. The secret is shared by both integrations.</p>
      </div>
      {url?.startsWith('/') && <p className="mt-1 text-xs text-amber-700">Set PUBLIC_URL in the server environment so this is an absolute URL.</p>}
      <div className="mt-3 flex gap-2">
        {which === 'invoiceNinja' && <Button size="sm" variant="secondary" disabled={!s?.hasInvoiceNinjaToken} loading={register.isPending} onClick={() => register.mutate(undefined)}>Register webhooks in Invoice Ninja</Button>}
        <Button size="sm" variant="ghost" onClick={() => confirm('Generate a new secret URL? The old one stops working immediately.') && rotate.mutate(undefined)}>Rotate URL</Button>
        <Button size="sm" variant="ghost" onClick={() => confirm('Generate a new header secret? Both Invoice Ninja and Docuseal must be updated (re-run “Register webhooks”, and edit the Docuseal webhook).') && rotateSecret.mutate(undefined)}>Rotate header secret</Button>
      </div>
      {register.isSuccess && <p className="mt-2 text-sm text-emerald-700">Webhooks registered.</p>}
      {(register.error || rotate.error || rotateSecret.error) && <div className="mt-2"><Alert>{register.error || rotate.error || rotateSecret.error}</Alert></div>}
    </Card>
  );
}

function Users() {
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: '', email: '', password: '', role: 'STAFF' });
  const create = useMutate(() => api('/users', { body: v }), [['users']], () => { setOpen(false); setV({ name: '', email: '', password: '', role: 'STAFF' }); });
  const update = useMutate(({ id, ...body }: any) => api(`/users/${id}`, { method: 'PATCH', body }), [['users']]);
  return (
    <Card title="Users" actions={<Button size="sm" onClick={() => setOpen(true)}>Add user</Button>}>
      <p className="mb-3 text-sm text-slate-500">Admin: everything incl. settings. Staff: manage bookings, inventory, clients. Read-only: view only.</p>
      {update.error && <Alert>{update.error}</Alert>}
      {isLoading ? <Spinner /> : (
        <Table head={['Name', 'Email', 'Role', 'Status', '']}>
          {data?.map((u: any) => (
            <tr key={u.id}>
              <Td className="font-medium">{u.name}</Td><Td>{u.email}</Td>
              <Td><Select value={u.role} disabled={u.id === me?.id} onChange={(e) => update.mutate({ id: u.id, role: e.target.value })}><option value="ADMIN">Admin</option><option value="STAFF">Staff</option><option value="READ_ONLY">Read-only</option></Select></Td>
              <Td>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}</Td>
              <Td className="space-x-1 whitespace-nowrap text-right">
                {u.id !== me?.id && <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, active: !u.active })}>{u.active ? 'Disable' : 'Enable'}</Button>}
                <Button size="sm" variant="ghost" onClick={() => { const p = prompt('New password (min 10 characters)'); if (p) update.mutate({ id: u.id, password: p }); }}>Reset password</Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={open} title="Add user" onClose={() => setOpen(false)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
          <Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></Field>
          <Field label="Email"><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required /></Field>
          <Field label="Temporary password" hint="At least 10 characters"><Input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} required /></Field>
          <Field label="Role"><Select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}><option value="ADMIN">Admin</option><option value="STAFF">Staff</option><option value="READ_ONLY">Read-only</option></Select></Field>
          {create.error && <Alert>{create.error}</Alert>}
          <Button loading={create.isPending}>Create user</Button>
        </form>
      </Modal>
    </Card>
  );
}

const ACTION_TONE: Record<string, any> = { created: 'green', updated: 'blue', linked: 'amber', unchanged: 'slate' };
const ACTION_LABEL: Record<string, string> = { created: 'New', updated: 'Update', linked: 'Link existing', unchanged: 'Up to date' };

function ClientSync() {
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [showAll, setShowAll] = useState(false);
  const load = useMutate(() => api('/invoice-ninja/clients/preview'), [], (r) => { setPreview(r); setResult(null); });
  const run = useMutate(() => api('/invoice-ninja/clients/import', { method: 'POST' }), [['clients']], (r) => { setResult(r); setPreview(null); });
  const data = result ?? preview;
  const items = (data?.items ?? []).filter((i: any) => showAll || i.action !== 'unchanged');
  return (
    <Card title="Client sync" actions={<>
      <Button size="sm" variant="secondary" onClick={() => load.mutate(undefined)} loading={load.isPending}>Preview import</Button>
      {preview && <Button size="sm" onClick={() => run.mutate(undefined)} loading={run.isPending}>Import {preview.created + preview.updated + preview.linked} change(s)</Button>}
    </>}>
      <p className="mb-3 text-sm text-slate-500">
        Invoice Ninja is the source of truth for client details. Importing brings in all active Invoice Ninja clients: existing HireStation
        clients are matched by Invoice Ninja link, then email, then ABN, so nothing is duplicated. After that, clients created or changed
        in Invoice Ninja update here automatically through the webhook (re-run “Register webhooks” once to add client events).
        HireStation’s own notes and bookings are never overwritten, and nothing is deleted here.
      </p>
      {(load.error || run.error) && <Alert>{load.error || run.error}</Alert>}
      {data && (
        <div className="space-y-3">
          <Alert tone={result ? 'green' : 'blue'}>
            {result ? 'Imported' : 'Preview'} — {data.total} Invoice Ninja client(s): <strong>{data.created}</strong> new, <strong>{data.updated}</strong> to update,{' '}
            <strong>{data.linked}</strong> existing HireStation client(s) to link, {data.unchanged} already up to date.
          </Alert>
          <label className="inline-flex items-center gap-2 text-sm font-normal"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show up-to-date clients</label>
          <Table head={['Client', 'Action', 'Changes']} empty="Nothing to change.">
            {items.slice(0, 300).map((i: any, n: number) => (
              <tr key={n}><Td className="font-medium">{i.name}</Td><Td><Badge tone={ACTION_TONE[i.action]}>{ACTION_LABEL[i.action]}</Badge></Td><Td className="text-xs text-slate-500">{i.changes?.join(', ')}</Td></tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}

function SignOutEverywhere() {
  const out = useMutate(() => api('/auth/logout-all', { method: 'POST' }), []);
  return (
    <Card title="Sessions">
      <p className="mb-3 text-sm text-slate-500">Signs you out on every other device and browser. Changing your password does this automatically.</p>
      <Button variant="secondary" onClick={() => out.mutate(undefined)} loading={out.isPending}>Sign out everywhere else</Button>
      {out.isSuccess && <span className="ml-3 text-sm text-emerald-700">Other sessions signed out.</span>}
      {out.error && <Alert>{out.error}</Alert>}
    </Card>
  );
}

function WebhookLog() {
  const { dateTime } = useFormat();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<any>(null);
  const { data, isLoading } = useQuery({ queryKey: ['webhook-events', status], queryFn: () => api(`/webhook-events?status=${status}`), refetchInterval: 15_000 });
  const replay = useMutate((id: string) => api(`/webhook-events/${id}/replay`, { method: 'POST' }), [['webhook-events']]);
  const replayAll = useMutate(() => api('/webhook-events/replay-failed', { body: {} }), [['webhook-events']]);
  const state = (e: any) => e.processed ? (e.error ? <Badge tone="amber">Ignored</Badge> : <Badge tone="green">Processed</Badge>) : e.error ? <Badge tone="red">Failed</Badge> : <Badge tone="blue">Pending</Badge>;
  return (
    <Card title="Webhook log" actions={<>
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-40"><option value="">All</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="processed">Processed</option></Select>
      <Button size="sm" variant="secondary" onClick={() => replayAll.mutate(undefined)} loading={replayAll.isPending}>Retry all unprocessed</Button>
    </>}>
      <p className="mb-3 text-sm text-slate-500">Events received from Invoice Ninja and Docuseal. Failed events are retried automatically; you can also replay any event.</p>
      {(replay.error || replayAll.error) && <Alert>{replay.error || replayAll.error}</Alert>}
      {replayAll.isSuccess && <p className="mb-2 text-sm text-emerald-700">Queued {replayAll.data.queued} event(s).</p>}
      {isLoading ? <Spinner /> : (
        <Table head={['Received', 'Source', 'Event', 'Status', 'Attempts', 'Note', '']} empty="No webhook events received yet.">
          {data?.map((e: any) => (
            <tr key={e.id}>
              <Td>{dateTime(e.receivedAt)}</Td><Td>{e.source}</Td><Td className="font-mono text-xs">{e.event}</Td><Td>{state(e)}</Td><Td>{e.attempts}</Td>
              <Td className="max-w-xs truncate text-xs text-slate-500" >{e.error}</Td>
              <Td className="space-x-1 whitespace-nowrap text-right"><Button size="sm" variant="ghost" onClick={() => setOpen(e)}>Payload</Button><Button size="sm" variant="ghost" onClick={() => replay.mutate(e.id)}>Replay</Button></Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!open} title="Webhook payload" onClose={() => setOpen(null)} wide>
        <pre className="max-h-[60vh] overflow-auto rounded bg-slate-50 p-3 text-xs">{open && JSON.stringify(open.payload, null, 2)}</pre>
      </Modal>
    </Card>
  );
}

function AuditLog() {
  const { dateTime } = useFormat();
  const [q, setQ] = useState('');
  const [pages, setPages] = useState<any[][]>([]);
  const first = useQuery({ queryKey: ['audit', q], queryFn: () => api(`/audit?q=${encodeURIComponent(q)}`) });
  useEffect(() => setPages([]), [q]);
  const rows = [...(first.data ?? []), ...pages.flat()];
  const more = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    const next = await api(`/audit?q=${encodeURIComponent(q)}&before=${encodeURIComponent(last.at)}`);
    setPages((p) => [...p, next]);
  };
  const [open, setOpen] = useState<any>(null);
  const tone = (s?: number) => (!s ? 'slate' : s < 300 ? 'green' : s < 500 ? 'amber' : 'red');
  return (
    <Card title="Audit log">
      <p className="mb-3 text-sm text-slate-500">Every sign-in and every change made through the app, with who made it. Secrets are never recorded.</p>
      <Input placeholder="Filter by action or person (e.g. auth.login, bookings, Sam)" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 max-w-md" />
      {first.isLoading ? <Spinner /> : (
        <Table head={['When', 'Who', 'Action', 'Record', 'Result', 'IP', '']}>
          {rows.map((l: any) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap">{dateTime(l.at)}</Td><Td>{l.userName ?? <span className="text-slate-400">anonymous</span>}</Td>
              <Td className="font-mono text-xs">{l.action}</Td>
              <Td className="text-xs">{l.entity}{l.entityId && (l.entity === 'bookings' ? <> · <Link className="text-brand-accent" to={`/bookings/${l.entityId}`}>open</Link></> : '')}</Td>
              <Td>{l.status ? <Badge tone={tone(l.status)}>{l.status}</Badge> : null}</Td>
              <Td className="text-xs text-slate-500">{l.ip}</Td>
              <Td>{l.detail && <Button size="sm" variant="ghost" onClick={() => setOpen(l)}>Details</Button>}</Td>
            </tr>
          ))}
        </Table>
      )}
      {rows.length >= 100 && <div className="mt-3 text-center"><Button size="sm" variant="secondary" onClick={more}>Load older</Button></div>}
      <Modal open={!!open} title={open?.action ?? ''} onClose={() => setOpen(null)} wide>
        <pre className="max-h-[60vh] overflow-auto rounded bg-slate-50 p-3 text-xs">{open && JSON.stringify(open.detail, null, 2)}</pre>
      </Modal>
    </Card>
  );
}

function Account() {
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const save = useMutate(() => { if (v.next !== v.confirm) throw new Error('Passwords do not match'); return api('/auth/password', { body: { current: v.current, next: v.next } }); }, [], () => setV({ current: '', next: '', confirm: '' }));
  return (
    <div className="space-y-6">
    <Card title="Change password">
      <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <Field label="Current password"><Input type="password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} /></Field>
        <Field label="New password"><Input type="password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} /></Field>
        <Field label="Confirm new password"><Input type="password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} /></Field>
        {save.error && <Alert>{save.error}</Alert>}
        {save.isSuccess && <Alert tone="green">Password changed. Other devices have been signed out.</Alert>}
        <Button loading={save.isPending}>Update password</Button>
      </form>
    </Card>
    <SignOutEverywhere />
    </div>
  );
}
