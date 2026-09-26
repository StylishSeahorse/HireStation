import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { STATUS_META, fromLocalInput, toLocalInput, useFormat } from '@/lib/format';
import { useMutate } from '@/lib/useMutate';
import { useMe, useSettings } from '@/lib/hooks';
import { formatAbn } from '@/lib/au';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from '@/components/ui';
import { ClientForm } from './Clients';
import { Checklists } from './Checklists';

// ---------------------------------------------------------------- list
export function BookingList() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const nav = useNavigate();
  const { dateTime } = useFormat();
  const { data, isLoading } = useQuery({ queryKey: ['bookings', q, status], queryFn: () => api(`/bookings?q=${encodeURIComponent(q)}&status=${status}`) });
  return (
    <>
      <PageHeader title="Bookings" actions={<Link to="/bookings/new"><Button>New booking</Button></Link>} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input placeholder="Search reference, title, venue, client" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-48"><option value="">All statuses</option>{Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</Select>
        </div>
        {isLoading ? <Spinner /> : (
          <Table head={['Ref', 'Title', 'Client', 'Venue', 'Load-in', 'Load-out', 'Status']}>
            {data?.map((b: any) => (
              <tr key={b.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/bookings/${b.id}`)}>
                <Td className="font-mono text-xs">{b.reference}</Td><Td className="font-medium">{b.title}</Td><Td>{b.client.name}</Td><Td>{b.venue}</Td>
                <Td>{dateTime(b.loadIn)}</Td><Td>{dateTime(b.loadOut)}</Td><Td><StatusBadge status={b.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- multi-step form
const STEPS = ['Client', 'Dates & venue', 'Equipment', 'Staff', 'Pricing summary'];

export function BookingForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { data: settings } = useSettings();
  const tz = settings?.timezone ?? 'UTC';
  const { money } = useFormat();
  const existing = useQuery({ queryKey: ['booking', id], queryFn: () => api(`/bookings/${id}`), enabled: !!id });
  const clients = useQuery({ queryKey: ['clients', ''], queryFn: () => api('/clients') });
  const equipment = useQuery({ queryKey: ['equipment', '', '', false], queryFn: () => api('/equipment') });
  const staffQ = useQuery({ queryKey: ['staff'], queryFn: () => api('/staff') });
  const [step, setStep] = useState(0);
  const [newClient, setNewClient] = useState(false);
  const [v, setV] = useState<any>({ title: '', clientId: params.get('clientId') ?? '', venue: '', venueAddress: '', loadIn: '', eventStart: '', eventEnd: '', loadOut: '', notes: '', status: 'ENQUIRY', discountPercent: 0, bondAmount: 0, lineItems: [], staff: [] });
  const [eqFilter, setEqFilter] = useState('');

  useEffect(() => {
    const b = existing.data;
    if (!b) return;
    setV({
      title: b.title, clientId: b.clientId, venue: b.venue ?? '', venueAddress: b.venueAddress ?? '', notes: b.notes ?? '', status: b.status,
      loadIn: toLocalInput(b.loadIn, tz), loadOut: toLocalInput(b.loadOut, tz), eventStart: toLocalInput(b.eventStart, tz), eventEnd: toLocalInput(b.eventEnd, tz),
      discountPercent: Number(b.discountPercent), bondAmount: Number(b.bondAmount),
      lineItems: b.lineItems.map((l: any) => ({ equipmentId: l.equipmentId, qtyBooked: l.qtyBooked, dailyRate: Number(l.dailyRate) })),
      staff: b.staff.map((s: any) => ({ staffId: s.staffId, role: s.role, rate: s.rate ?? '', hours: s.hours ?? '' })),
    });
  }, [existing.data, tz]);

  const iso = (x: string) => (x ? fromLocalInput(x, tz) : null);
  const range = { loadIn: iso(v.loadIn), loadOut: iso(v.loadOut) };
  const availability = useQuery({
    queryKey: ['availability', range.loadIn, range.loadOut, id],
    queryFn: () => api(`/availability?start=${range.loadIn}&end=${range.loadOut}${id ? `&excludeBookingId=${id}` : ''}`),
    enabled: !!range.loadIn && !!range.loadOut && range.loadOut > range.loadIn,
  });
  const avail = new Map<string, any>((availability.data ?? []).map((a: any) => [a.equipmentId, a]));
  const eqMap = new Map<string, any>((equipment.data ?? []).map((e: any) => [e.id, e]));

  const days = useMemo(() => {
    const s = iso(v.eventStart) ?? range.loadIn, e = iso(v.eventEnd) ?? range.loadOut;
    if (!s || !e) return 1;
    return Math.max(1, Math.ceil((new Date(e).getTime() - new Date(s).getTime()) / 86_400_000));
  }, [v.eventStart, v.eventEnd, v.loadIn, v.loadOut]);

  // Client-side estimate; the server recalculates authoritative totals on save.
  const summary = useMemo(() => {
    const gstRate = settings?.gstRegistered ? Number(settings.gstRate) : 0;
    let taxable = 0, exempt = 0;
    const rows = v.lineItems.map((l: any) => {
      const e = eqMap.get(l.equipmentId);
      const rate = l.dailyRate ?? Number(e?.dailyRate ?? 0);
      const total = rate * l.qtyBooked * days;
      if (e?.gstTaxable === false) exempt += total; else taxable += total;
      return { name: e?.name, qty: l.qtyBooked, rate, total };
    });
    const labour = v.staff.reduce((a: number, s: any) => a + Number(s.rate || 0) * Number(s.hours || 0), 0);
    const disc = Number(v.discountPercent || 0) / 100;
    const sub = (taxable + exempt) * (1 - disc) + labour;
    const gst = ((taxable * (1 - disc)) + labour) * gstRate / 100;
    return { rows, labour, discount: (taxable + exempt) * disc, sub, gst, total: sub + gst };
  }, [v, days, settings, equipment.data]);

  const save = useMutate(() => api(id ? `/bookings/${id}` : '/bookings', {
    method: id ? 'PUT' : 'POST',
    body: {
      ...v, loadIn: range.loadIn, loadOut: range.loadOut, eventStart: iso(v.eventStart), eventEnd: iso(v.eventEnd),
      staff: v.staff.map((s: any) => ({ ...s, rate: s.rate === '' ? null : s.rate, hours: s.hours === '' ? null : s.hours })),
    },
  }), [['bookings'], ['booking', id]], (b) => nav(`/bookings/${b.id}`));

  const setLine = (eid: string, qty: number) => {
    const others = v.lineItems.filter((l: any) => l.equipmentId !== eid);
    const cur = v.lineItems.find((l: any) => l.equipmentId === eid);
    setV({ ...v, lineItems: qty > 0 ? [...others, { ...(cur ?? { equipmentId: eid }), qtyBooked: qty }] : others });
  };
  const qtyOf = (eid: string) => v.lineItems.find((l: any) => l.equipmentId === eid)?.qtyBooked ?? 0;
  const conflicts = v.lineItems.filter((l: any) => { const a = avail.get(l.equipmentId); return a && l.qtyBooked > a.available; });

  const canNext = [!!v.clientId, !!v.title && !!range.loadIn && !!range.loadOut && range.loadOut! > range.loadIn!, true, v.staff.every((s: any) => s.staffId && s.role), true][step];
  if (id && existing.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title={id ? `Edit ${existing.data?.reference}` : 'New booking'} />
      <ol className="mb-4 flex flex-wrap gap-1 text-xs">
        {STEPS.map((t, i) => <li key={t}><button onClick={() => setStep(i)} className={clsx('rounded-full px-2.5 py-1', i === step ? 'bg-brand text-white' : 'bg-white text-slate-600')}>{i + 1}. {t}</button></li>)}
      </ol>
      <Card>
        {step === 0 && (
          <div className="space-y-3">
            <Field label="Client">
              <div className="flex gap-2">
                <Select value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value })}>
                  <option value="">Select a client…</option>
                  {clients.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ''}</option>)}
                </Select>
                <Button type="button" variant="secondary" onClick={() => setNewClient(true)}>New client</Button>
              </div>
            </Field>
            <Modal open={newClient} title="New client" onClose={() => setNewClient(false)} wide>
              <ClientForm onCancel={() => setNewClient(false)} onSaved={(c) => { setV({ ...v, clientId: c.id }); setNewClient(false); clients.refetch(); }} />
            </Modal>
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Event / booking title" className="sm:col-span-2"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
            <Field label="Venue"><Input value={v.venue} onChange={(e) => setV({ ...v, venue: e.target.value })} /></Field>
            <Field label="Venue address"><Input value={v.venueAddress} onChange={(e) => setV({ ...v, venueAddress: e.target.value })} /></Field>
            <Field label="Load-in" hint={`Times are ${tz}`}><Input type="datetime-local" value={v.loadIn} onChange={(e) => setV({ ...v, loadIn: e.target.value })} /></Field>
            <Field label="Load-out"><Input type="datetime-local" value={v.loadOut} onChange={(e) => setV({ ...v, loadOut: e.target.value })} /></Field>
            <Field label="Event start (optional)" hint="Hire days are charged on event start–end if set, otherwise load-in to load-out"><Input type="datetime-local" value={v.eventStart} onChange={(e) => setV({ ...v, eventStart: e.target.value })} /></Field>
            <Field label="Event end (optional)"><Input type="datetime-local" value={v.eventEnd} onChange={(e) => setV({ ...v, eventEnd: e.target.value })} /></Field>
            <Field label="Status"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{['ENQUIRY', 'QUOTED', 'CONFIRMED'].concat(id ? Object.keys(STATUS_META).filter((k) => !['ENQUIRY', 'QUOTED', 'CONFIRMED'].includes(k)) : []).map((k) => <option key={k} value={k}>{STATUS_META[k].label}</option>)}</Select></Field>
            <Field label="Internal notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            {!range.loadIn && <Alert tone="amber">Set dates first to see availability.</Alert>}
            <Input placeholder="Filter equipment" value={eqFilter} onChange={(e) => setEqFilter(e.target.value)} className="max-w-xs" />
            <Table head={['Item', 'Rate/day', 'Available', 'Qty']}>
              {equipment.data?.filter((e: any) => !eqFilter || e.name.toLowerCase().includes(eqFilter.toLowerCase()) || qtyOf(e.id)).map((e: any) => {
                const a = avail.get(e.id); const q = qtyOf(e.id);
                return (
                  <tr key={e.id} className={q ? 'bg-slate-50' : ''}>
                    <Td className="font-medium">{e.name}<div className="text-xs text-slate-400">{e.category?.name}</div></Td>
                    <Td>{money(e.dailyRate)}</Td>
                    <Td>{a ? <span className={q > a.available ? 'font-semibold text-rose-600' : ''}>{a.available} / {a.stock}</span> : '—'}</Td>
                    <Td><Input type="number" min={0} className="w-20" value={q || ''} onChange={(x) => setLine(e.id, Number(x.target.value))} /></Td>
                  </tr>
                );
              })}
            </Table>
            {conflicts.length > 0 && <Alert tone="amber">Double-booking warning: {conflicts.map((l: any) => `${eqMap.get(l.equipmentId)?.name} (need ${l.qtyBooked}, ${Math.max(0, avail.get(l.equipmentId).available)} free)`).join('; ')}. You can still save, but resolve before the event.</Alert>}
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            {v.staff.map((s: any, i: number) => (
              <div key={i} className="grid gap-2 sm:grid-cols-5">
                <Select value={s.staffId} onChange={(e) => { const x = [...v.staff]; x[i] = { ...s, staffId: e.target.value }; setV({ ...v, staff: x }); }} className="sm:col-span-2">
                  <option value="">Select…</option>{staffQ.data?.filter((st: any) => st.active).map((st: any) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </Select>
                <Input placeholder="Role (e.g. FOH engineer)" value={s.role} onChange={(e) => { const x = [...v.staff]; x[i] = { ...s, role: e.target.value }; setV({ ...v, staff: x }); }} />
                <Input placeholder="Rate/hr (optional)" type="number" step="0.01" value={s.rate} onChange={(e) => { const x = [...v.staff]; x[i] = { ...s, rate: e.target.value }; setV({ ...v, staff: x }); }} />
                <div className="flex gap-2"><Input placeholder="Hours" type="number" value={s.hours} onChange={(e) => { const x = [...v.staff]; x[i] = { ...s, hours: e.target.value }; setV({ ...v, staff: x }); }} />
                  <Button type="button" variant="ghost" onClick={() => setV({ ...v, staff: v.staff.filter((_: any, j: number) => j !== i) })}>✕</Button></div>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setV({ ...v, staff: [...v.staff, { staffId: '', role: '', rate: '', hours: '' }] })}>Assign staff</Button>
            <p className="text-xs text-slate-500">Staff with a rate and hours are charged as labour lines.</p>
          </div>
        )}
        {step === 4 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Discount (%)"><Input type="number" min={0} max={100} value={v.discountPercent} onChange={(e) => setV({ ...v, discountPercent: e.target.value })} /></Field>
              <Field label="Security bond" hint="Held separately — never part of the GST invoice unless forfeited"><Input type="number" min={0} step="0.01" value={v.bondAmount} onChange={(e) => setV({ ...v, bondAmount: e.target.value })} /></Field>
              <div className="pt-6 text-sm text-slate-500">{days} hire day{days === 1 ? '' : 's'}</div>
            </div>
            <Table head={['Item', 'Qty', 'Rate', 'Total']}>
              {summary.rows.map((r: any, i: number) => <tr key={i}><Td>{r.name}</Td><Td>{r.qty}</Td><Td>{money(r.rate)}</Td><Td>{money(r.total)}</Td></tr>)}
            </Table>
            <dl className="ml-auto max-w-xs space-y-1 text-sm">
              {summary.labour > 0 && <div className="flex justify-between"><dt>Labour</dt><dd>{money(summary.labour)}</dd></div>}
              {summary.discount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{money(summary.discount)}</dd></div>}
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(summary.sub)}</dd></div>
              {settings?.gstRegistered && <div className="flex justify-between"><dt>GST ({Number(settings.gstRate)}%)</dt><dd>{money(summary.gst)}</dd></div>}
              <div className="flex justify-between border-t pt-1 font-semibold"><dt>Total</dt><dd>{money(summary.total)}</dd></div>
              {Number(v.bondAmount) > 0 && <div className="flex justify-between text-slate-500"><dt>Bond (separate)</dt><dd>{money(v.bondAmount)}</dd></div>}
            </dl>
            {save.error && <Alert>{save.error}</Alert>}
          </div>
        )}
        <div className="mt-6 flex justify-between border-t pt-4">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 4 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</Button> : <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{id ? 'Save changes' : 'Create booking'}</Button>}
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- detail
const TABS = ['Overview', 'Checklists', 'Contract', 'Invoice', 'Bond'] as const;

export function BookingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [dup, setDup] = useState(false);
  const { data: me } = useMe();
  const { dateTime, cents } = useFormat();
  const { data: b, isLoading } = useQuery({ queryKey: ['booking', id], queryFn: () => api(`/bookings/${id}`) });
  const status = useMutate((s: string) => api(`/bookings/${id}/status`, { method: 'PATCH', body: { status: s } }), [['booking', id], ['bookings']]);
  const del = useMutate(() => api(`/bookings/${id}`, { method: 'DELETE' }), [['bookings']], () => nav('/bookings'));
  if (isLoading || !b) return <Spinner />;
  const ro = me?.role === 'READ_ONLY';
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-3">{b.title} <StatusBadge status={b.status} /></span>}
        subtitle={<>{b.reference} · <Link to={`/clients/${b.client.id}`} className="text-brand-accent">{b.client.name}</Link>{b.venue ? ` · ${b.venue}` : ''}</>}
        actions={!ro && <>
          <Select value={b.status} onChange={(e) => status.mutate(e.target.value)} className="max-w-44">{Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</Select>
          <Link to={`/bookings/${b.id}/edit`}><Button variant="secondary">Edit</Button></Link>
          <Button variant="secondary" onClick={() => setDup(true)}>Duplicate</Button>
          {!b.contracts.length && !b.invoices.length && <Button variant="ghost" onClick={() => confirm('Delete this booking?') && del.mutate(undefined)}>Delete</Button>}
        </>}
      />
      {b.conflicts.length > 0 && <div className="mb-4"><Alert tone="amber"><strong>Equipment conflict:</strong> {b.conflicts.map((c: any) => `${c.name} short by ${c.shortBy} — ${c.bookings.length ? `clashes with ${c.bookings.map((x: any) => x.reference).join(', ')}` : `only ${c.stock} in stock`}`).join('; ')}</Alert></div>}
      {(status.error || del.error) && <div className="mb-4"><Alert>{status.error || del.error}</Alert></div>}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={clsx('whitespace-nowrap border-b-2 px-3 py-2 text-sm', tab === t ? 'border-brand font-medium' : 'border-transparent text-slate-500')}>{t}</button>)}
      </div>
      {tab === 'Overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Equipment" className="lg:col-span-2">
            <Table head={['Item', 'Qty', 'Days', 'Rate', 'Total']}>
              {b.lineItems.map((l: any) => <tr key={l.id}><Td><Link to={`/equipment/${l.equipmentId}`}>{l.equipment.name}</Link></Td><Td>{l.qtyBooked}</Td><Td>{Number(l.days)}</Td><Td>{cents(Number(l.dailyRate) * 100)}</Td><Td>{cents(Number(l.dailyRate) * 100 * l.qtyBooked * Number(l.days))}</Td></tr>)}
            </Table>
            <Totals t={b.quote} title="Quote (booked items)" />
            {b.usage && <Totals t={b.usage} title="Actual (from return checklist)" />}
          </Card>
          <div className="space-y-6">
            <Card title="Schedule">
              <dl className="space-y-2 text-sm">
                <div><dt className="text-slate-500">Load-in</dt><dd>{dateTime(b.loadIn)}</dd></div>
                {b.eventStart && <div><dt className="text-slate-500">Event</dt><dd>{dateTime(b.eventStart)} – {dateTime(b.eventEnd)}</dd></div>}
                <div><dt className="text-slate-500">Load-out</dt><dd>{dateTime(b.loadOut)}</dd></div>
                {b.venueAddress && <div><dt className="text-slate-500">Venue address</dt><dd>{b.venueAddress}</dd></div>}
              </dl>
            </Card>
            <Card title="Staff">
              {b.staff.length === 0 ? <p className="text-sm text-slate-400">No staff assigned</p> : <ul className="space-y-1 text-sm">{b.staff.map((s: any) => <li key={s.id}><Link to={`/staff/${s.staffId}`}>{s.staff.name}</Link> — {s.role}</li>)}</ul>}
            </Card>
            {b.notes && <Card title="Internal notes"><p className="whitespace-pre-wrap text-sm">{b.notes}</p></Card>}
          </div>
        </div>
      )}
      {tab === 'Checklists' && <Checklists booking={b} readOnly={ro} />}
      {tab === 'Contract' && <ContractTab booking={b} readOnly={ro} />}
      {tab === 'Invoice' && <InvoiceTab booking={b} readOnly={ro} />}
      {tab === 'Bond' && <BondTab booking={b} readOnly={ro} />}
      <DuplicateModal open={dup} onClose={() => setDup(false)} booking={b} />
    </>
  );
}

function Totals({ t, title }: { t: any; title: string }) {
  const { cents } = useFormat();
  const { data: s } = useSettings();
  return (
    <div className="mt-4 border-t pt-3">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <dl className="ml-auto max-w-xs space-y-1 text-sm">
        {t.lines.filter((l: any) => l.kind !== 'HIRE').map((l: any) => <div key={l.key} className="flex justify-between gap-4"><dt className="truncate">{l.description}</dt><dd>{cents(l.lineTotal)}</dd></div>)}
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{cents(t.subtotal)}</dd></div>
        {s?.gstRegistered && <div className="flex justify-between"><dt>GST</dt><dd>{cents(t.gstTotal)}</dd></div>}
        <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{cents(t.total)}</dd></div>
      </dl>
    </div>
  );
}

function DuplicateModal({ open, onClose, booking }: { open: boolean; onClose: () => void; booking: any }) {
  const nav = useNavigate();
  const { data: s } = useSettings();
  const tz = s?.timezone ?? 'UTC';
  const [loadIn, setLoadIn] = useState(() => toLocalInput(new Date(new Date(booking.loadIn).getTime() + 7 * 86_400_000).toISOString(), tz));
  const [title, setTitle] = useState(booking.title);
  const dup = useMutate(() => api(`/bookings/${booking.id}/duplicate`, { body: { loadIn: fromLocalInput(loadIn, tz), title } }), [['bookings']], (b) => { onClose(); nav(`/bookings/${b.id}`); });
  return (
    <Modal open={open} title="Duplicate booking" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">Copies equipment, staff, venue and pricing. All times shift relative to the new load-in.</p>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="New load-in"><Input type="datetime-local" value={loadIn} onChange={(e) => setLoadIn(e.target.value)} /></Field>
        {dup.error && <Alert>{dup.error}</Alert>}
        <div className="flex justify-end"><Button onClick={() => dup.mutate(undefined)} loading={dup.isPending}>Duplicate</Button></div>
      </div>
    </Modal>
  );
}

const CONTRACT_TONE: Record<string, any> = { DRAFT: 'slate', SENT: 'blue', VIEWED: 'blue', SIGNED: 'green', DECLINED: 'red', VOID: 'slate' };

function ContractTab({ booking: b, readOnly }: { booking: any; readOnly: boolean }) {
  const { dateTime } = useFormat();
  const { data: s } = useSettings();
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api('/templates') });
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const inv = [['booking', b.id]];
  const create = useMutate((send: boolean) => api(`/bookings/${b.id}/contracts`, { body: { templateId, send } }), inv);
  const send = useMutate((cid: string) => api(`/contracts/${cid}/send`, { method: 'POST' }), inv);
  const voidC = useMutate((cid: string) => api(`/contracts/${cid}/void`, { method: 'POST' }), inv);
  const err = create.error || send.error || voidC.error;
  return (
    <div className="space-y-6">
      {!readOnly && (
        <Card title="Generate contract">
          {!s?.hasDocusealToken && <div className="mb-3"><Alert tone="amber">Docuseal isn’t connected — you can generate contracts but not send them. Connect it in Settings.</Alert></div>}
          {!b.client.email && <div className="mb-3"><Alert tone="amber">This client has no email address; Docuseal needs one to send the signing link.</Alert></div>}
          <div className="flex flex-wrap gap-2">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="max-w-xs">
              <option value="">Choose a template…</option>
              {templates.data?.filter((t: any) => !t.archived).map((t: any) => <option key={t.id} value={t.id}>{t.name} (v{t.latestVersion})</option>)}
            </Select>
            <Button variant="secondary" disabled={!templateId} loading={create.isPending} onClick={() => create.mutate(false)}>Generate draft</Button>
            <Button disabled={!templateId || !s?.hasDocusealToken || !b.client.email} loading={create.isPending} onClick={() => create.mutate(true)}>Generate & send for signature</Button>
          </div>
          {templates.data?.length === 0 && <p className="mt-2 text-sm text-slate-500">No templates yet — <Link to="/contracts" className="text-brand-accent">create one</Link>.</p>}
        </Card>
      )}
      {err && <Alert>{err}</Alert>}
      <Card title="Contracts">
        <Table head={['Template', 'Status', 'Sent', 'Signed', '']} empty="No contracts yet.">
          {b.contracts.map((c: any) => (
            <tr key={c.id}>
              <Td>{c.templateVersion.template.name} <span className="text-xs text-slate-400">v{c.templateVersion.version}</span></Td>
              <Td><Badge tone={CONTRACT_TONE[c.status]}>{c.status}</Badge></Td>
              <Td>{dateTime(c.sentAt)}</Td><Td>{dateTime(c.signedAt)}</Td>
              <Td className="space-x-2 whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => setPreview(`/api/contracts/${c.id}/html`)}>View</Button>
                {c.signedPdfPath && <a href={`/api/contracts/${c.id}/signed`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary">Signed PDF</Button></a>}
                {!readOnly && c.status === 'DRAFT' && <Button size="sm" onClick={() => send.mutate(c.id)} disabled={!s?.hasDocusealToken}>Send</Button>}
                {!readOnly && ['DRAFT', 'SENT', 'VIEWED'].includes(c.status) && <Button size="sm" variant="ghost" onClick={() => confirm('Void this contract?') && voidC.mutate(c.id)}>Void</Button>}
              </Td>
            </tr>
          ))}
        </Table>
        {send.isSuccess && <p className="mt-2 text-sm text-emerald-700">Queued — Docuseal will email the signing link shortly.</p>}
      </Card>
      <Modal open={!!preview} title="Contract" onClose={() => setPreview(null)} wide>
        {preview && <iframe src={preview} sandbox="allow-modals" className="h-[70vh] w-full rounded border" />}
      </Modal>
    </div>
  );
}

function InvoiceTab({ booking: b, readOnly }: { booking: any; readOnly: boolean }) {
  const { money, dateTime } = useFormat();
  const { data: s } = useSettings();
  const gen = useMutate((adjust: boolean) => api(`/bookings/${b.id}/invoice`, { body: { adjust } }), [['booking', b.id]]);
  const sync = useMutate((iid: string) => api(`/invoices/${iid}/sync`, { method: 'POST' }), [['booking', b.id]]);
  const returned = b.returnInventory?.completed;
  const issued = b.invoices.some((i: any) => i.kind === 'INVOICE' && i.status !== 'DRAFT' && i.status !== 'CANCELLED');
  return (
    <div className="space-y-6">
      <Card title="Invoicing" actions={!readOnly && returned && <>
        <Button variant="secondary" disabled={!s?.hasInvoiceNinjaToken} loading={gen.isPending} onClick={() => gen.mutate(false)}>{b.invoices.length ? 'Regenerate draft' : 'Generate invoice'}</Button>
        {issued && <Button variant="secondary" disabled={!s?.hasInvoiceNinjaToken} onClick={() => confirm('Create a follow-up invoice or credit note for any difference between the issued invoice and the current return record?') && gen.mutate(true)}>Adjust issued invoice</Button>}
      </>}>
        {!returned && <Alert tone="blue">Invoices are generated automatically from the completed return checklist — i.e. what actually went out and came back, plus damage and late fees.</Alert>}
        {!s?.hasInvoiceNinjaToken && <div className="mt-2"><Alert tone="amber">Invoice Ninja isn’t connected. Connect it in Settings.</Alert></div>}
        {(gen.error || sync.error) && <div className="mt-2"><Alert>{gen.error || sync.error}</Alert></div>}
        <Table head={['Number', 'Kind', 'Status', 'Subtotal', 'GST', 'Total', 'Paid', 'Created', '']} empty="No invoices yet.">
          {b.invoices.map((i: any) => (
            <tr key={i.id}>
              <Td>{i.number ?? '—'}</Td><Td>{i.kind}</Td><Td><Badge tone={i.status === 'PAID' ? 'green' : i.status === 'DRAFT' ? 'slate' : 'amber'}>{i.status}</Badge></Td>
              <Td>{money(i.subtotal)}</Td><Td>{money(i.gstTotal)}</Td><Td className="font-medium">{money(i.total)}</Td><Td>{money(i.amountPaid)}</Td><Td>{dateTime(i.createdAt)}</Td>
              <Td className="space-x-2 whitespace-nowrap">
                {i.hostedUrl && <a href={i.hostedUrl} target="_blank" rel="noreferrer" className="text-sm text-brand-accent">Open</a>}
                {!readOnly && <Button size="sm" variant="ghost" onClick={() => sync.mutate(i.id)}>Refresh</Button>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

const BOND_LABEL: Record<string, string> = { NONE: 'No bond', HELD: 'Held', REFUNDED: 'Refunded', PARTIALLY_FORFEITED: 'Partially forfeited', FULLY_FORFEITED: 'Fully forfeited' };

function BondTab({ booking: b, readOnly }: { booking: any; readOnly: boolean }) {
  const { money, dateTime } = useFormat();
  const [v, setV] = useState({ bondStatus: b.bondStatus, bondForfeited: Number(b.bondForfeited), bondNotes: b.bondNotes ?? '' });
  const save = useMutate(() => api(`/bookings/${b.id}/bond`, { method: 'PATCH', body: v }), [['booking', b.id]]);
  const refund = useQuery({ queryKey: ['refund', b.id, b.bondStatus, b.bondForfeited], queryFn: () => api(`/bookings/${b.id}/bond/refund-instructions`) });
  const damages = (b.returnInventory?.lines ?? []).reduce((a: number, l: any) => a + Number(l.damageCharge), 0);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Security bond">
        <p className="mb-3 text-sm text-slate-500">Bonds are GST-free while held and are kept out of the tax invoice. A forfeited amount is added to the invoice as consideration for damage/loss (GST-inclusive).</p>
        <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Amount</dt><dd className="font-medium">{money(b.bondAmount)}</dd>
          <dt className="text-slate-500">Status</dt><dd>{BOND_LABEL[b.bondStatus]}</dd>
          {b.bondRefundedAt && <><dt className="text-slate-500">Settled</dt><dd>{dateTime(b.bondRefundedAt)}</dd></>}
          {damages > 0 && <><dt className="text-slate-500">Return damage charges</dt><dd className="text-rose-600">{money(damages)}</dd></>}
        </dl>
        {!readOnly && Number(b.bondAmount) > 0 && (
          <div className="space-y-3 border-t pt-3">
            <Field label="Bond outcome">
              <Select value={v.bondStatus} onChange={(e) => setV({ ...v, bondStatus: e.target.value })}>{Object.entries(BOND_LABEL).filter(([k]) => k !== 'NONE').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            </Field>
            {v.bondStatus === 'PARTIALLY_FORFEITED' && <Field label="Amount forfeited (GST-inclusive)"><Input type="number" step="0.01" value={v.bondForfeited} onChange={(e) => setV({ ...v, bondForfeited: Number(e.target.value) })} /></Field>}
            <Field label="Notes"><Textarea value={v.bondNotes} onChange={(e) => setV({ ...v, bondNotes: e.target.value })} /></Field>
            {save.error && <Alert>{save.error}</Alert>}
            <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save bond outcome</Button>
            {b.invoices.some((i: any) => i.status !== 'DRAFT') && v.bondStatus.includes('FORFEITED') && <p className="text-xs text-slate-500">The invoice has already been issued — use “Adjust issued invoice” on the Invoice tab to bill the forfeited amount.</p>}
          </div>
        )}
      </Card>
      {refund.data && Number(b.bondAmount) > 0 && (
        <Card title="Refund instructions">
          <div className="space-y-2 text-sm">
            <p>Refund due to <strong>{refund.data.client}</strong>: <strong>{money(refund.data.refundAmount)}</strong>{refund.data.forfeited > 0 && <> ({money(refund.data.bondAmount)} bond less {money(refund.data.forfeited)} forfeited)</>}.</p>
            <p>Pay by direct deposit from:</p>
            <dl className="grid grid-cols-2 gap-1 rounded bg-slate-50 p-3">
              <dt className="text-slate-500">Account name</dt><dd>{refund.data.business.accountName}</dd>
              <dt className="text-slate-500">BSB</dt><dd>{refund.data.business.bsb}</dd>
              <dt className="text-slate-500">Account</dt><dd>{refund.data.business.accountNumber}</dd>
              <dt className="text-slate-500">Reference</dt><dd>{refund.data.reference} bond refund</dd>
            </dl>
            {b.client.abn && <p className="text-xs text-slate-500">Client ABN {formatAbn(b.client.abn)}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
