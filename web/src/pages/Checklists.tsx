import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFormat, toLocalInput, fromLocalInput } from '@/lib/format';
import { useMutate } from '@/lib/useMutate';
import { useMe, useSettings } from '@/lib/hooks';
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td, Textarea } from '@/components/ui';

export function Checklists({ booking: b, readOnly }: { booking: any; readOnly: boolean }) {
  return (
    <div className="space-y-6">
      <Departure booking={b} readOnly={readOnly} />
      {b.departure?.completed && <Return booking={b} readOnly={readOnly} />}
    </div>
  );
}

function Departure({ booking: b, readOnly }: { booking: any; readOnly: boolean }) {
  const { dateTime } = useFormat();
  const equipment = useQuery({ queryKey: ['equipment', '', '', false], queryFn: () => api('/equipment') });
  const dep = useQuery({ queryKey: ['departure', b.id], queryFn: () => api(`/bookings/${b.id}/departure`) });
  const [lines, setLines] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [add, setAdd] = useState('');
  useEffect(() => { if (dep.data) { setLines(dep.data.lines.map((l: any) => ({ ...l }))); setNotes(dep.data.notes ?? ''); } }, [dep.data]);
  const eq = new Map<string, any>((equipment.data ?? []).map((e: any) => [e.id, e]));
  const booked = new Map<string, number>(b.lineItems.map((l: any) => [l.equipmentId, l.qtyBooked]));
  const units = useQuery({
    queryKey: ['units-for', b.id],
    queryFn: async () => Object.fromEntries(await Promise.all(b.lineItems.filter((l: any) => l.equipment.serialised).map(async (l: any) => [l.equipmentId, (await api(`/equipment/${l.equipmentId}`)).units.filter((u: any) => !u.retired)]))),
  });
  const save = useMutate((complete: boolean) => api(`/bookings/${b.id}/departure?complete=${complete}`, { method: 'PUT', body: { notes, lines: lines.map(({ equipmentId, qtyOut, unitIds }) => ({ equipmentId, qtyOut: Number(qtyOut), unitIds: unitIds ?? [] })) } }), [['departure', b.id], ['booking', b.id], ['return', b.id]]);
  const done = dep.data?.completed;
  const locked = readOnly || !!b.returnInventory?.completed;
  return (
    <Card title={<span className="flex items-center gap-2">Departure checklist {done ? <Badge tone="green">Completed {dateTime(dep.data.completedAt)} by {dep.data.completedBy}</Badge> : <Badge tone="amber">Not completed</Badge>}</span>}>
      <p className="mb-3 text-sm text-slate-500">Confirm what actually left the warehouse. Add or remove items used on the day — invoicing follows this record, not the original booking.</p>
      <Table head={['Item', 'Booked', 'Qty out', 'Units']}>
        {lines.map((l, i) => {
          const e = eq.get(l.equipmentId);
          const u = units.data?.[l.equipmentId] as any[] | undefined;
          return (
            <tr key={l.equipmentId}>
              <Td className="font-medium">{e?.name ?? '…'}{!booked.has(l.equipmentId) && <Badge tone="blue">added</Badge>}</Td>
              <Td>{booked.get(l.equipmentId) ?? 0}</Td>
              <Td><Input type="number" min={0} className="w-20" disabled={locked} value={l.qtyOut} onChange={(x) => { const n = [...lines]; n[i] = { ...l, qtyOut: x.target.value }; setLines(n); }} /></Td>
              <Td>{u ? (
                <div className="flex flex-wrap gap-2">{u.map((unit) => (
                  <label key={unit.id} className="inline-flex items-center gap-1 text-xs font-normal">
                    <input type="checkbox" disabled={locked} checked={(l.unitIds ?? []).includes(unit.id)} onChange={(x) => { const n = [...lines]; const ids = new Set(l.unitIds ?? []); x.target.checked ? ids.add(unit.id) : ids.delete(unit.id); n[i] = { ...l, unitIds: [...ids], qtyOut: ids.size }; setLines(n); }} />
                    {unit.serialNumber}{unit.condition !== 'GOOD' && <span className="text-amber-600">({unit.condition})</span>}
                  </label>
                ))}</div>
              ) : '—'}</Td>
            </tr>
          );
        })}
      </Table>
      {!locked && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Select value={add} onChange={(e) => setAdd(e.target.value)} className="max-w-xs"><option value="">Add an item used on the day…</option>{equipment.data?.filter((e: any) => !lines.some((l) => l.equipmentId === e.id)).map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
          <Button size="sm" variant="secondary" disabled={!add} onClick={() => { setLines([...lines, { equipmentId: add, qtyOut: 1, unitIds: [] }]); setAdd(''); }}>Add</Button>
        </div>
      )}
      <Field label="Notes" className="mt-3"><Textarea value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)} /></Field>
      {save.error && <div className="mt-2"><Alert>{save.error}</Alert></div>}
      {!locked && (
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending}>{done ? 'Reopen & save' : 'Save draft'}</Button>
          <Button onClick={() => save.mutate(true)} loading={save.isPending}>{done ? 'Save' : 'Complete departure'}</Button>
        </div>
      )}
    </Card>
  );
}

function Return({ booking: b, readOnly }: { booking: any; readOnly: boolean }) {
  const { dateTime } = useFormat();
  const { data: s } = useSettings();
  const { data: me } = useMe();
  const [amending, setAmending] = useState(false);
  const tz = s?.timezone ?? 'UTC';
  const equipment = useQuery({ queryKey: ['equipment', '', '', false], queryFn: () => api('/equipment') });
  const ret = useQuery({ queryKey: ['return', b.id], queryFn: () => api(`/bookings/${b.id}/return`) });
  const [v, setV] = useState<any>(null);
  useEffect(() => { if (ret.data) setV({ ...ret.data, lateFee: Number(ret.data.lateFee), returnedAt: toLocalInput(ret.data.returnedAt, tz), lines: ret.data.lines.map((l: any) => ({ ...l, damageCharge: Number(l.damageCharge) })) }); }, [ret.data, tz]);
  const eq = new Map<string, any>((equipment.data ?? []).map((e: any) => [e.id, e]));
  const save = useMutate((complete: boolean) => api(`/bookings/${b.id}/return?complete=${complete}`, {
    method: 'PUT',
    body: { notes: v.notes, lateFee: v.lateFee, returnedAt: v.returnedAt ? fromLocalInput(v.returnedAt, tz) : null, lines: v.lines.map(({ equipmentId, qtyReturned, condition, damageNotes, damageCharge }: any) => ({ equipmentId, qtyReturned: Number(qtyReturned), condition, damageNotes, damageCharge })) },
  }), [['return', b.id], ['booking', b.id]], () => setAmending(false));
  if (!v) return null;
  const done = v.completed;
  const locked = readOnly || (done && !amending);
  const late = v.returnedAt && fromLocalInput(v.returnedAt, tz) > b.loadOut;
  const upd = (i: number, patch: any) => { const n = [...v.lines]; n[i] = { ...n[i], ...patch }; setV({ ...v, lines: n }); };
  return (
    <Card title={<span className="flex items-center gap-2">Return checklist {done ? <Badge tone="green">Completed {dateTime(v.completedAt)} by {v.completedBy}</Badge> : <Badge tone="amber">Not completed</Badge>}{v.lateReturn && <Badge tone="red">Late return</Badge>}</span>}>
      <Table head={['Item', 'Out', 'Returned', 'Condition', 'Damage notes', 'Charge']}>
        {v.lines.map((l: any, i: number) => (
          <tr key={l.equipmentId} className={Number(l.qtyReturned) < l.qtyOut ? 'bg-rose-50' : ''}>
            <Td className="font-medium">{eq.get(l.equipmentId)?.name}</Td>
            <Td>{l.qtyOut}</Td>
            <Td><Input type="number" min={0} max={l.qtyOut} className="w-20" disabled={locked} value={l.qtyReturned} onChange={(e) => upd(i, { qtyReturned: e.target.value })} /></Td>
            <Td><Select value={l.condition} disabled={locked} onChange={(e) => upd(i, { condition: e.target.value })}>{['GOOD', 'FAIR', 'DAMAGED', 'LOST'].map((c) => <option key={c}>{c}</option>)}</Select></Td>
            <Td><Input value={l.damageNotes ?? ''} disabled={locked} onChange={(e) => upd(i, { damageNotes: e.target.value })} /></Td>
            <Td><Input type="number" step="0.01" min={0} className="w-28" disabled={locked} value={l.damageCharge} onChange={(e) => upd(i, { damageCharge: e.target.value })} />
              {Number(l.qtyReturned) < l.qtyOut && eq.get(l.equipmentId)?.replacementValue && !locked && <button className="mt-1 block text-xs text-brand-accent" onClick={() => upd(i, { damageCharge: (l.qtyOut - Number(l.qtyReturned)) * Number(eq.get(l.equipmentId).replacementValue) })}>Use replacement value</button>}
            </Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Field label="Returned at" hint={late ? 'After scheduled load-out — flagged late' : undefined}><Input type="datetime-local" disabled={locked} value={v.returnedAt ?? ''} onChange={(e) => setV({ ...v, returnedAt: e.target.value })} /></Field>
        <Field label="Late fee (ex GST)"><Input type="number" step="0.01" min={0} disabled={locked} value={v.lateFee} onChange={(e) => setV({ ...v, lateFee: e.target.value })} /></Field>
        <Field label="Notes"><Textarea rows={1} disabled={locked} value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
      {save.error && <div className="mt-2"><Alert>{save.error}</Alert></div>}
      {!locked && (
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending}>Save draft</Button>
          <Button onClick={() => confirm('Complete the return? This generates the invoice in Invoice Ninja from these quantities and charges.') && save.mutate(true)} loading={save.isPending}>Complete return & invoice</Button>
        </div>
      )}
      {done && !amending && (
        <div className="mt-3 flex items-center gap-3 text-sm text-slate-500">
          <span>After amending, use the Invoice tab to regenerate the draft or adjust an issued invoice.</span>
          {me?.role === 'ADMIN' && <Button size="sm" variant="secondary" onClick={() => setAmending(true)}>Amend return</Button>}
        </div>
      )}
    </Card>
  );
}
