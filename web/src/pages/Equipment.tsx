import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFormat, toLocalInput, fromLocalInput } from '@/lib/format';
import { useMutate } from '@/lib/useMutate';
import { useMe, useSettings } from '@/lib/hooks';
import { code128Svg } from '@/lib/code128';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from '@/components/ui';

const blank = { name: '', sku: '', barcode: '', description: '', categoryId: '', tags: [] as string[], dailyRate: '', replacementValue: '', gstTaxable: true, stockQuantity: 1, serialised: false };

function EquipmentForm({ initial, onSaved, onCancel }: { initial?: any; onSaved: (e: any) => void; onCancel: () => void }) {
  const [v, setV] = useState<any>(() => initial ? { ...blank, ...initial, sku: initial.sku ?? '', barcode: initial.barcode ?? '', categoryId: initial.categoryId ?? '', replacementValue: initial.replacementValue ?? '' } : blank);
  const [tagText, setTagText] = useState((initial?.tags ?? []).join(', '));
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const { data: s } = useSettings();
  const [newCat, setNewCat] = useState('');
  const save = useMutate((body: any) => api(initial ? `/equipment/${initial.id}` : '/equipment', { method: initial ? 'PUT' : 'POST', body }), [['equipment'], ['barcodes']], onSaved);
  const addCat = useMutate((name: string) => api('/categories', { body: { name } }), [['categories']], (c) => { setV({ ...v, categoryId: c.id }); setNewCat(''); });
  const f = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      save.mutate({ ...v, replacementValue: v.replacementValue === '' ? null : v.replacementValue, tags: tagText.split(',').map((t: string) => t.trim()).filter(Boolean) });
    }}>
      <Field label="Name" className="sm:col-span-2"><Input value={v.name} onChange={f('name')} required /></Field>
      <Field label="SKU / code"><Input value={v.sku} onChange={f('sku')} /></Field>
      <Field label="Barcode" hint={initial ? 'Clear it to remove the barcode' : 'Leave blank to generate one, or type the code of a label it already has'}><Input value={v.barcode} onChange={f('barcode')} className="font-mono" /></Field>
      <Field label="Category">
        <div className="flex gap-2">
          <Select value={v.categoryId} onChange={f('categoryId')}>
            <option value="">—</option>
            {cats.data?.map((c: any) => <option key={c.id} value={c.id}>{c.parentId ? '— ' : ''}{c.name}</option>)}
          </Select>
          <Input placeholder="New…" value={newCat} onChange={(e) => setNewCat(e.target.value)} className="max-w-28" />
          <Button type="button" variant="secondary" size="sm" disabled={!newCat} onClick={() => addCat.mutate(newCat)}>Add</Button>
        </div>
      </Field>
      <Field label="Daily hire rate (ex GST)"><Input type="number" step="0.01" min="0" value={v.dailyRate} onChange={f('dailyRate')} required /></Field>
      <Field label="Replacement value"><Input type="number" step="0.01" min="0" value={v.replacementValue} onChange={f('replacementValue')} /></Field>
      <div className="space-y-2">
        <Checkbox label="Serialised (track individual units)" checked={v.serialised} onChange={(c) => setV({ ...v, serialised: c })} />
        {!v.serialised && <Field label="Stock quantity"><Input type="number" min="0" value={v.stockQuantity} onChange={f('stockQuantity')} /></Field>}
      </div>
      <div>
        <Checkbox label="GST taxable" checked={v.gstTaxable} onChange={(c) => setV({ ...v, gstTaxable: c })} />
        {s && !s.gstRegistered && <p className="mt-1 text-xs text-slate-500">The business is not GST-registered, so no GST is charged regardless.</p>}
      </div>
      <Field label="Tags" hint="Comma separated" className="sm:col-span-2"><Input value={tagText} onChange={(e) => setTagText(e.target.value)} /></Field>
      <Field label="Description" className="sm:col-span-2"><Textarea value={v.description ?? ''} onChange={f('description')} /></Field>
      {save.error && <div className="sm:col-span-2"><Alert>{save.error}</Alert></div>}
      <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button loading={save.isPending}>Save</Button></div>
    </form>
  );
}

export function EquipmentList() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const { money } = useFormat();
  const { data: me } = useMe();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const { data, isLoading } = useQuery({ queryKey: ['equipment', q, cat, archived], queryFn: () => api(`/equipment?q=${encodeURIComponent(q)}&categoryId=${cat}&archived=${archived}`) });
  return (
    <>
      <PageHeader title="Equipment" actions={<>
        <Link to="/equipment/availability"><Button variant="secondary">Availability</Button></Link>
        <Link to="/equipment/labels"><Button variant="secondary">Barcode labels</Button></Link>
        {me?.role !== 'READ_ONLY' && <Button onClick={() => setCreating(true)}>Add equipment</Button>}
      </>} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input placeholder="Filter by name, SKU, barcode or tag" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="max-w-48"><option value="">All categories</option>{cats.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Checkbox label="Show archived" checked={archived} onChange={setArchived} />
        </div>
        {isLoading ? <Spinner /> : (
          <Table head={['', 'Name', 'Category', 'Stock', 'Daily rate', 'GST', 'Tags']}>
            {data?.map((e: any) => (
              <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/equipment/${e.id}`)}>
                <Td>{e.photos[0] ? <img src={`/api/equipment/${e.id}/photos/0`} className="h-9 w-9 rounded object-cover" /> : <div className="h-9 w-9 rounded bg-slate-100" />}</Td>
                <Td><div className="font-medium">{e.name}</div><div className="text-xs text-slate-400">{e.sku}</div></Td>
                <Td>{e.category?.name}</Td>
                <Td>{e.serialised ? `${e._count.units} units` : e.stockQuantity}</Td>
                <Td>{money(e.dailyRate)}</Td>
                <Td>{e.gstTaxable ? <Badge tone="blue">Taxable</Badge> : <Badge>GST-free</Badge>}</Td>
                <Td><div className="flex flex-wrap gap-1">{e.tags.map((t: string) => <Badge key={t}>{t}</Badge>)}</div></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={creating} title="Add equipment" onClose={() => setCreating(false)} wide>
        <EquipmentForm onCancel={() => setCreating(false)} onSaved={(e) => nav(`/equipment/${e.id}`)} />
      </Modal>
    </>
  );
}

export function EquipmentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const { money, date } = useFormat();
  const { data: me } = useMe();
  const canEdit = me?.role !== 'READ_ONLY';
  const { data: e, isLoading } = useQuery({ queryKey: ['equipment', id], queryFn: () => api(`/equipment/${id}`) });
  const upload = useMutate((files: FileList) => { const f = new FormData(); Array.from(files).forEach((x) => f.append('file', x)); return api(`/equipment/${id}/photos`, { form: f }); }, [['equipment', id]]);
  const delPhoto = useMutate((i: number) => api(`/equipment/${id}/photos/${i}`, { method: 'DELETE' }), [['equipment', id]]);
  const del = useMutate(() => api(`/equipment/${id}`, { method: 'DELETE' }), [['equipment']], () => nav('/equipment'));
  const [unit, setUnit] = useState({ serialNumber: '', condition: 'GOOD', conditionNotes: '' });
  const addUnit = useMutate(() => api(`/equipment/${id}/units`, { body: unit }), [['equipment', id]], () => setUnit({ serialNumber: '', condition: 'GOOD', conditionNotes: '' }));
  const updUnit = useMutate(({ uid, ...body }: any) => api(`/units/${uid}`, { method: 'PATCH', body }), [['equipment', id], ['barcodes']]);
  const genCodes = useMutate(() => api('/equipment/barcodes/generate', { body: { equipmentIds: [id] } }), [['equipment', id], ['barcodes']]);
  if (isLoading || !e) return <Spinner />;
  return (
    <>
      <PageHeader title={e.name} subtitle={[e.sku, e.category?.name].filter(Boolean).join(' · ')} actions={canEdit && <>
        <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="danger" onClick={() => confirm('Delete this item? Items used on bookings are archived instead.') && del.mutate(undefined)}>Delete</Button>
      </>} />
      {e.archived && <div className="mb-4"><Alert tone="amber">This item is archived.</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-slate-500">Daily rate</dt><dd className="font-medium">{money(e.dailyRate)}</dd></div>
            <div><dt className="text-slate-500">Replacement</dt><dd>{e.replacementValue ? money(e.replacementValue) : '—'}</dd></div>
            <div><dt className="text-slate-500">Stock</dt><dd>{e.serialised ? `${e.units.filter((u: any) => !u.retired).length} units` : e.stockQuantity}</dd></div>
            <div><dt className="text-slate-500">GST</dt><dd>{e.gstTaxable ? 'Taxable' : 'GST-free'}</dd></div>
          </dl>
          {e.description && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">{e.description}</p>}
          <div className="mt-3 flex flex-wrap gap-1">{e.tags.map((t: string) => <Badge key={t}>{t}</Badge>)}</div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
            {e.barcode ? <BarcodeImage code={e.barcode} /> : <span className="text-sm text-slate-400">No barcode</span>}
            {canEdit && (!e.barcode || (e.serialised && e.units.some((u: any) => !u.barcode && !u.retired))) && (
              <Button size="sm" variant="secondary" onClick={() => genCodes.mutate(undefined)} loading={genCodes.isPending}>{e.barcode ? 'Generate unit barcodes' : 'Generate barcode'}</Button>
            )}
            {e.barcode && <Link to={`/equipment/labels?ids=${e.id}`}><Button size="sm" variant="secondary">Print labels</Button></Link>}
          </div>
          {genCodes.error && <Alert>{genCodes.error}</Alert>}
        </Card>
        <Card title="Photos" actions={canEdit && <label className="cursor-pointer text-sm text-brand-accent">Upload<input type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(x) => x.target.files && upload.mutate(x.target.files)} /></label>}>
          {upload.error && <Alert>{upload.error}</Alert>}
          <div className="grid grid-cols-3 gap-2">
            {e.photos.map((_: string, i: number) => (
              <div key={i} className="group relative">
                <img src={`/api/equipment/${e.id}/photos/${i}`} className="aspect-square w-full rounded object-cover" />
                {canEdit && <button onClick={() => delPhoto.mutate(i)} className="absolute right-1 top-1 hidden rounded bg-black/60 px-1 text-xs text-white group-hover:block">✕</button>}
              </div>
            ))}
          </div>
          {e.photos.length === 0 && <p className="text-sm text-slate-400">No photos</p>}
        </Card>
        {e.serialised && (
          <Card title="Units" className="lg:col-span-2">
            <Table head={['Serial', 'Barcode', 'Condition', 'Notes', '']}>
              {e.units.map((u: any) => (
                <tr key={u.id} className={u.retired ? 'opacity-50' : ''}>
                  <Td>{u.serialNumber}</Td>
                  <Td><Input key={u.barcode ?? ''} defaultValue={u.barcode ?? ''} disabled={!canEdit} className="w-36 font-mono" onBlur={(x) => x.target.value.trim().toUpperCase() !== (u.barcode ?? '') && updUnit.mutate({ uid: u.id, barcode: x.target.value || null })} /></Td>
                  <Td><Select value={u.condition} disabled={!canEdit} onChange={(x) => updUnit.mutate({ uid: u.id, condition: x.target.value })}>{['GOOD', 'FAIR', 'DAMAGED', 'IN_REPAIR'].map((c) => <option key={c}>{c}</option>)}</Select></Td>
                  <Td><Input defaultValue={u.conditionNotes ?? ''} disabled={!canEdit} onBlur={(x) => x.target.value !== (u.conditionNotes ?? '') && updUnit.mutate({ uid: u.id, conditionNotes: x.target.value })} /></Td>
                  <Td>{canEdit && <Button size="sm" variant="ghost" onClick={() => updUnit.mutate({ uid: u.id, retired: !u.retired })}>{u.retired ? 'Reinstate' : 'Retire'}</Button>}</Td>
                </tr>
              ))}
            </Table>
            {canEdit && (
              <form className="mt-3 flex flex-wrap gap-2" onSubmit={(x) => { x.preventDefault(); addUnit.mutate(undefined); }}>
                <Input placeholder="Serial number" value={unit.serialNumber} onChange={(x) => setUnit({ ...unit, serialNumber: x.target.value })} className="max-w-48" required />
                <Input placeholder="Condition notes" value={unit.conditionNotes} onChange={(x) => setUnit({ ...unit, conditionNotes: x.target.value })} className="max-w-xs" />
                <Button size="sm">Add unit</Button>
              </form>
            )}
            {(addUnit.error || updUnit.error) && <Alert>{addUnit.error || updUnit.error}</Alert>}
          </Card>
        )}
        <Card title="Upcoming bookings" className="lg:col-span-1">
          <Table head={['Booking', 'Dates', 'Qty']} empty="Not booked.">
            {e.upcoming.map((l: any) => <tr key={l.id}><Td><Link to={`/bookings/${l.booking.id}`} className="text-brand-accent">{l.booking.reference}</Link><div><StatusBadge status={l.booking.status} /></div></Td><Td>{date(l.booking.loadIn)}–{date(l.booking.loadOut)}</Td><Td>{l.qtyBooked}</Td></tr>)}
          </Table>
        </Card>
      </div>
      <Modal open={editing} title="Edit equipment" onClose={() => setEditing(false)} wide>
        <EquipmentForm initial={e} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
      </Modal>
    </>
  );
}

export function Availability() {
  const { data: s } = useSettings();
  const tz = s?.timezone ?? 'UTC';
  const { dateTime } = useFormat();
  const today = new Date(); today.setHours(8, 0, 0, 0);
  const [start, setStart] = useState(toLocalInput(today.toISOString(), tz));
  const [end, setEnd] = useState(toLocalInput(new Date(today.getTime() + 86_400_000).toISOString(), tz));
  const eq = useQuery({ queryKey: ['equipment', '', '', false], queryFn: () => api('/equipment') });
  const s1 = fromLocalInput(start, tz), e1 = fromLocalInput(end, tz);
  const { data, error } = useQuery({ queryKey: ['availability', s1, e1], queryFn: () => api(`/availability?start=${s1}&end=${e1}`), enabled: !!s1 && !!e1 && e1 > s1 });
  const names = new Map((eq.data ?? []).map((e: any) => [e.id, e.name]));
  return (
    <>
      <PageHeader title="Availability" subtitle="What’s free versus already allocated for a date range" />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Field label="From"><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="To"><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {error && <Alert>{String((error as Error).message)}</Alert>}
        <Table head={['Item', 'Stock', 'Allocated', 'Available', 'Allocated to']}>
          {data?.map((a: any) => (
            <tr key={a.equipmentId}>
              <Td><Link to={`/equipment/${a.equipmentId}`} className="font-medium">{names.get(a.equipmentId) as string}</Link></Td>
              <Td>{a.stock}</Td><Td>{a.allocated}</Td>
              <Td><span className={a.available <= 0 ? 'font-semibold text-rose-600' : 'text-emerald-700'}>{a.available}</span></Td>
              <Td>{a.bookings.map((b: any) => <div key={b.id} className="text-xs"><Link to={`/bookings/${b.id}`} className="text-brand-accent">{b.reference}</Link> ×{b.qty} ({dateTime(b.loadIn)} → {dateTime(b.loadOut)})</div>)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

/** The item's own barcode, as printed on its labels. */
function BarcodeImage({ code }: { code: string }) {
  const svg = useMemo(() => code128Svg(code), [code]);
  return (
    <div className="inline-flex flex-col items-center">
      <div className="h-12 w-48 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="font-mono text-xs">{code}</span>
    </div>
  );
}
