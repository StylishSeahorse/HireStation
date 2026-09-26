import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatAbn, isValidAbn } from '@/lib/au';
import { useFormat } from '@/lib/format';
import { useMutate } from '@/lib/useMutate';
import { useMe } from '@/lib/hooks';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from '@/components/ui';

export function ClientForm({ initial, onSaved, onCancel }: { initial?: any; onSaved: (c: any) => void; onCancel: () => void }) {
  const [v, setV] = useState<any>(initial ?? { type: 'INDIVIDUAL', name: '', contactName: '', email: '', phone: '', abn: '', address: '', notes: '' });
  const save = useMutate((body: any) => api(initial ? `/clients/${initial.id}` : '/clients', { method: initial ? 'PUT' : 'POST', body }), [['clients']], onSaved);
  const f = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  const abnBad = v.abn && !isValidAbn(v.abn);
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...v, abn: v.type === 'BUSINESS' ? v.abn : null }); }}>
      <Field label="Type"><Select value={v.type} onChange={f('type')}><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></Select></Field>
      <Field label={v.type === 'BUSINESS' ? 'Business name' : 'Full name'}><Input value={v.name} onChange={f('name')} required /></Field>
      {v.type === 'BUSINESS' && <Field label="Contact person"><Input value={v.contactName ?? ''} onChange={f('contactName')} /></Field>}
      {v.type === 'BUSINESS' && <Field label="ABN" error={abnBad ? 'ABN checksum is invalid' : undefined}><Input value={v.abn ?? ''} onChange={f('abn')} /></Field>}
      <Field label="Email" hint="Used for contract signing and invoices"><Input type="email" value={v.email ?? ''} onChange={f('email')} /></Field>
      <Field label="Phone"><Input value={v.phone ?? ''} onChange={f('phone')} /></Field>
      <Field label="Address" className="sm:col-span-2"><Input value={v.address ?? ''} onChange={f('address')} /></Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes ?? ''} onChange={f('notes')} /></Field>
      {save.error && <div className="sm:col-span-2"><Alert>{save.error}</Alert></div>}
      <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button loading={save.isPending}>Save</Button></div>
    </form>
  );
}

export function ClientList() {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({ queryKey: ['clients', q], queryFn: () => api(`/clients?q=${encodeURIComponent(q)}`) });
  return (
    <>
      <PageHeader title="Clients" actions={me?.role !== 'READ_ONLY' && <Button onClick={() => setCreating(true)}>Add client</Button>} />
      <Card>
        <Input placeholder="Search name, email, ABN" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 max-w-xs" />
        {isLoading ? <Spinner /> : (
          <Table head={['Name', 'Type', 'Email', 'Phone', 'Bookings']}>
            {data?.map((c: any) => (
              <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/clients/${c.id}`)}>
                <Td className="font-medium">{c.name}</Td><Td><Badge tone={c.type === 'BUSINESS' ? 'blue' : 'slate'}>{c.type === 'BUSINESS' ? 'Business' : 'Individual'}</Badge></Td>
                <Td>{c.email}</Td><Td>{c.phone}</Td><Td>{c._count.bookings}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={creating} title="Add client" onClose={() => setCreating(false)} wide><ClientForm onCancel={() => setCreating(false)} onSaved={(c) => nav(`/clients/${c.id}`)} /></Modal>
    </>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const { date } = useFormat();
  const { data: me } = useMe();
  const { data: c, isLoading } = useQuery({ queryKey: ['clients', id], queryFn: () => api(`/clients/${id}`) });
  const del = useMutate(() => api(`/clients/${id}`, { method: 'DELETE' }), [['clients']], () => nav('/clients'));
  if (isLoading || !c) return <Spinner />;
  return (
    <>
      <PageHeader title={c.name} subtitle={c.type === 'BUSINESS' ? `Business${c.abn ? ` · ABN ${formatAbn(c.abn)}` : ''}` : 'Individual'} actions={me?.role !== 'READ_ONLY' && <>
        <Link to={`/bookings/new?clientId=${c.id}`}><Button>New booking</Button></Link>
        <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="danger" onClick={() => confirm('Delete this client?') && del.mutate(undefined)}>Delete</Button>
      </>} />
      {del.error && <Alert>{del.error}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Contact">
          <dl className="space-y-2 text-sm">
            {c.contactName && <div><dt className="text-slate-500">Contact</dt><dd>{c.contactName}</dd></div>}
            <div><dt className="text-slate-500">Email</dt><dd>{c.email || '—'}</dd></div>
            <div><dt className="text-slate-500">Phone</dt><dd>{c.phone || '—'}</dd></div>
            <div><dt className="text-slate-500">Address</dt><dd>{c.address || '—'}</dd></div>
            <div><dt className="text-slate-500">Invoice Ninja</dt><dd>{c.invoiceNinjaClientId ? 'Linked' : 'Not yet synced (created on first invoice)'}</dd></div>
          </dl>
          {c.notes && <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm text-slate-600">{c.notes}</p>}
        </Card>
        <Card title="Booking history" className="lg:col-span-2">
          <Table head={['Booking', 'Venue', 'Dates', 'Status']} empty="No bookings yet.">
            {c.bookings.map((b: any) => <tr key={b.id}><Td><Link to={`/bookings/${b.id}`} className="text-brand-accent">{b.reference}</Link> {b.title}</Td><Td>{b.venue}</Td><Td>{date(b.loadIn)} – {date(b.loadOut)}</Td><Td><StatusBadge status={b.status} /></Td></tr>)}
          </Table>
        </Card>
      </div>
      <Modal open={editing} title="Edit client" onClose={() => setEditing(false)} wide><ClientForm initial={c} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} /></Modal>
    </>
  );
}
