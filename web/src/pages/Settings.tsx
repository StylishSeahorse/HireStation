import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useMutate } from '@/lib/useMutate';
import { useMe, useSettings } from '@/lib/hooks';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { BankingForm, BrandingForm, clean, Draft, DocusealForm, IdentityForm, InvoiceNinjaForm, LocaleForm, TaxForm } from '@/components/SettingsForms';

const SECTIONS = [
  ['identity', 'Business identity'], ['tax', 'Tax'], ['banking', 'Banking'], ['branding', 'Branding'],
  ['invoiceNinja', 'Invoice Ninja'], ['docuseal', 'Docuseal'], ['locale', 'Locale & defaults'], ['users', 'Users'], ['account', 'My account'],
] as const;

const FIELDS: Record<string, string[]> = {
  identity: ['legalName', 'tradingName', 'structure', 'abn', 'acn', 'addressLine1', 'addressLine2', 'suburb', 'state', 'postcode', 'contactEmail', 'contactPhone', 'signatoryName', 'signatoryTitle'],
  tax: ['gstRegistered', 'gstRate'],
  banking: ['bankBsb', 'bankAccountNumber', 'bankAccountName'],
  branding: ['primaryColour', 'accentColour', 'documentFooter'],
  invoiceNinja: ['invoiceNinjaUrl', 'invoiceNinjaCompanyId'],
  docuseal: ['docusealUrl'],
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
        {name === 'docuseal' && <DocusealForm {...props} hasToken={s.hasDocusealToken} />}
        {name === 'locale' && <LocaleForm {...props} />}
        <div className="mt-4 flex items-center gap-3 border-t pt-4">
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save</Button>
          {save.isSuccess && <span className="text-sm text-emerald-700">Saved</span>}
        </div>
        {save.error && <div className="mt-2"><Alert>{save.error}</Alert></div>}
      </Card>
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
  const url = s?.webhookUrls?.[which];
  return (
    <Card title="Webhook (status sync)">
      <p className="mb-2 text-sm text-slate-500">
        {which === 'docuseal'
          ? 'In Docuseal → Settings → Webhooks, add this URL and enable form.viewed, form.completed and form.declined events.'
          : 'Invoice Ninja calls this URL when invoices change or payments arrive, so booking statuses update without polling.'}
      </p>
      <code className="block break-all rounded bg-slate-100 p-2 text-xs">{url ?? '—'}</code>
      {url?.startsWith('/') && <p className="mt-1 text-xs text-amber-700">Set PUBLIC_URL in the server environment so this is an absolute URL.</p>}
      <div className="mt-3 flex gap-2">
        {which === 'invoiceNinja' && <Button size="sm" variant="secondary" disabled={!s?.hasInvoiceNinjaToken} loading={register.isPending} onClick={() => register.mutate(undefined)}>Register webhooks in Invoice Ninja</Button>}
        <Button size="sm" variant="ghost" onClick={() => confirm('Generate a new secret URL? The old one stops working immediately.') && rotate.mutate(undefined)}>Rotate secret</Button>
      </div>
      {register.isSuccess && <p className="mt-2 text-sm text-emerald-700">Webhooks registered.</p>}
      {(register.error || rotate.error) && <div className="mt-2"><Alert>{register.error || rotate.error}</Alert></div>}
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

function Account() {
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const save = useMutate(() => { if (v.next !== v.confirm) throw new Error('Passwords do not match'); return api('/auth/password', { body: { current: v.current, next: v.next } }); }, [], () => setV({ current: '', next: '', confirm: '' }));
  return (
    <Card title="Change password">
      <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <Field label="Current password"><Input type="password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} /></Field>
        <Field label="New password"><Input type="password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} /></Field>
        <Field label="Confirm new password"><Input type="password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} /></Field>
        {save.error && <Alert>{save.error}</Alert>}
        {save.isSuccess && <Alert tone="green">Password changed.</Alert>}
        <Button loading={save.isPending}>Update password</Button>
      </form>
    </Card>
  );
}
