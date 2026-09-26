import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useMutate } from '@/lib/useMutate';
import { useMe } from '@/lib/hooks';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td } from '@/components/ui';

function StaffForm({ initial, onDone }: { initial?: any; onDone: (s?: any) => void }) {
  const [v, setV] = useState<any>(initial ?? { name: '', email: '', phone: '', skills: [], userId: '', active: true });
  const [skills, setSkills] = useState((initial?.skills ?? []).join(', '));
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const save = useMutate((body: any) => api(initial ? `/staff/${initial.id}` : '/staff', { method: initial ? 'PUT' : 'POST', body }), [['staff']], onDone);
  const f = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...v, userId: v.userId || null, skills: skills.split(',').map((x: string) => x.trim()).filter(Boolean) }); }}>
      <Field label="Name"><Input value={v.name} onChange={f('name')} required /></Field>
      <Field label="Email"><Input type="email" value={v.email ?? ''} onChange={f('email')} /></Field>
      <Field label="Phone"><Input value={v.phone ?? ''} onChange={f('phone')} /></Field>
      <Field label="Skills" hint="Comma separated, e.g. audio, lighting"><Input value={skills} onChange={(e) => setSkills(e.target.value)} /></Field>
      <Field label="Linked login" hint="Lets this person see their own schedule">
        <Select value={v.userId ?? ''} onChange={f('userId')}><option value="">None</option>{users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</Select>
      </Field>
      <div className="pt-6"><Checkbox label="Active" checked={v.active} onChange={(c) => setV({ ...v, active: c })} /></div>
      {save.error && <div className="sm:col-span-2"><Alert>{save.error}</Alert></div>}
      <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={() => onDone()}>Cancel</Button><Button loading={save.isPending}>Save</Button></div>
    </form>
  );
}

export function StaffList() {
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({ queryKey: ['staff'], queryFn: () => api('/staff') });
  return (
    <>
      <PageHeader title="Staff & technicians" actions={me?.role === 'ADMIN' && <Button onClick={() => setCreating(true)}>Add staff</Button>} />
      <Card>
        {isLoading ? <Spinner /> : (
          <Table head={['Name', 'Contact', 'Skills', 'Status']}>
            {data?.map((s: any) => (
              <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/staff/${s.id}`)}>
                <Td className="font-medium">{s.name}</Td><Td>{s.email}<div className="text-xs text-slate-400">{s.phone}</div></Td>
                <Td><div className="flex flex-wrap gap-1">{s.skills.map((k: string) => <Badge key={k}>{k}</Badge>)}</div></Td>
                <Td>{s.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={creating} title="Add staff member" onClose={() => setCreating(false)} wide><StaffForm onDone={(s) => { setCreating(false); if (s) nav(`/staff/${s.id}`); }} /></Modal>
    </>
  );
}

function Schedule({ items }: { items: any[] }) {
  const { dateTime } = useFormat();
  return (
    <Table head={['Booking', 'Role', 'Venue', 'Load-in', 'Load-out', 'Status']} empty="No upcoming assignments.">
      {items.map((a) => (
        <tr key={a.id}>
          <Td><Link to={`/bookings/${a.booking.id}`} className="text-brand-accent">{a.booking.reference}</Link> {a.booking.title}</Td>
          <Td>{a.role}</Td><Td>{a.booking.venue}</Td><Td>{dateTime(a.booking.loadIn)}</Td><Td>{dateTime(a.booking.loadOut)}</Td><Td><StatusBadge status={a.booking.status} /></Td>
        </tr>
      ))}
    </Table>
  );
}

export function StaffDetail() {
  const { id } = useParams();
  const [editing, setEditing] = useState(false);
  const { data: me } = useMe();
  const { data: s, isLoading } = useQuery({ queryKey: ['staff', id], queryFn: () => api(`/staff/${id}`) });
  if (isLoading || !s) return <Spinner />;
  return (
    <>
      <PageHeader title={s.name} subtitle={s.skills.join(', ')} actions={me?.role === 'ADMIN' && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>} />
      <Card title="Upcoming schedule"><Schedule items={s.schedule} /></Card>
      <Modal open={editing} title="Edit staff member" onClose={() => setEditing(false)} wide><StaffForm initial={s} onDone={() => setEditing(false)} /></Modal>
    </>
  );
}

export function MySchedule() {
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({ queryKey: ['my-schedule'], queryFn: () => api('/me/schedule') });
  return (
    <>
      <PageHeader title="My schedule" />
      {!me?.staffId && <div className="mb-4"><Alert tone="blue">Your login isn’t linked to a staff record yet. An admin can link it under Staff.</Alert></div>}
      <Card>{isLoading ? <Spinner /> : <Schedule items={data ?? []} />}</Card>
    </>
  );
}
