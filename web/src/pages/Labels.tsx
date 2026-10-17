import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { code128Svg } from '@/lib/code128';
import { useMutate } from '@/lib/useMutate';
import { BarcodeEntry } from '@/lib/scan';
import { Alert, Button, Checkbox, Field, Input, Select, Spinner } from '@/components/ui';

// Sizes in mm. Sheet layouts match the common A4 label sheets (Avery L7651 / L7159 and equivalents).
interface Layout { label: string; page: [number, number]; cols: number; rows: number; size: [number, number]; margin: [number, number]; pitch: [number, number] }
const LAYOUTS: Record<string, Layout> = {
  'a4-65': { label: 'A4 sheet, 65 labels (38.1 × 21.2 mm)', page: [210, 297], cols: 5, rows: 13, size: [38.1, 21.2], margin: [4.65, 10.7], pitch: [40.6, 21.2] },
  'a4-24': { label: 'A4 sheet, 24 labels (63.5 × 33.9 mm)', page: [210, 297], cols: 3, rows: 8, size: [63.5, 33.9], margin: [7.2, 12.9], pitch: [66, 33.9] },
};

interface Row { key: string; entry: BarcodeEntry; copies: number }

export default function Labels() {
  const [params] = useSearchParams();
  const ids = params.get('ids');
  const only = useMemo(() => ids?.split(',').filter(Boolean), [ids]);
  const codes = useQuery({ queryKey: ['barcodes'], queryFn: () => api('/barcodes') as Promise<BarcodeEntry[]> });
  const equipment = useQuery({ queryKey: ['equipment', '', '', false], queryFn: () => api('/equipment') });
  const assign = useMutate(() => api('/equipment/barcodes/generate', { body: only ? { equipmentIds: only } : {} }), [['barcodes'], ['equipment']]);
  const [layout, setLayout] = useState('a4-65');
  const [roll, setRoll] = useState({ w: 50, h: 25 });
  const [skip, setSkip] = useState(0);
  const [showName, setShowName] = useState(true);
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');

  const stock = useMemo(() => new Map<string, any>((equipment.data ?? []).map((e: any) => [e.id, e])), [equipment.data]);
  // One label per physical item by default: a product label for each item in stock, or one per unit.
  const rows: Row[] = useMemo(() => (codes.data ?? [])
    .filter((c) => !c.inactive && stock.has(c.equipmentId) && (!only || only.includes(c.equipmentId)))
    .map((c) => ({ key: c.code, entry: c, copies: copies[c.code] ?? (c.unitId ? 1 : c.serialised ? 0 : Math.max(1, stock.get(c.equipmentId)?.stockQuantity ?? 1)) }))
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name)), [codes.data, stock, copies, only]);
  const missing = (equipment.data ?? []).filter((e: any) => !e.barcode && (!only || only.includes(e.id))).length;
  const visible = rows.filter((r) => !q || r.entry.name.toLowerCase().includes(q.toLowerCase()) || r.entry.code.includes(q.toUpperCase()));
  const labels = rows.flatMap((r) => Array.from({ length: Math.max(0, r.copies) }, () => r.entry));

  if (codes.isLoading || equipment.isLoading) return <Spinner />;
  const sheet = LAYOUTS[layout];
  const pageSize: [number, number] = sheet ? sheet.page : [roll.w, roll.h];
  const perPage = sheet ? sheet.cols * sheet.rows : 1;
  const slots = [...Array<BarcodeEntry | null>(sheet ? Math.min(skip, perPage - 1) : 0).fill(null), ...labels];
  const pages = Array.from({ length: Math.ceil(slots.length / perPage) }, (_, i) => slots.slice(i * perPage, (i + 1) * perPage));

  return (
    <div className="min-h-screen bg-slate-100">
      <style>{`@page { size: ${pageSize[0]}mm ${pageSize[1]}mm; margin: 0 }
        @media print { body { background: #fff } .no-print { display: none !important } .sheet { box-shadow: none !important; margin: 0 !important } }`}</style>
      <div className="no-print mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/equipment" className="inline-flex items-center gap-1 text-sm text-slate-500"><ArrowLeft size={14} /> Equipment</Link>
          <h1 className="text-xl font-semibold">Print barcode labels</h1>
          <div className="ml-auto"><Button onClick={() => window.print()} disabled={!labels.length}><Printer size={16} /> Print {labels.length} label{labels.length === 1 ? '' : 's'}</Button></div>
        </div>
        {missing > 0 && (
          <Alert tone="amber">
            <div className="flex flex-wrap items-center gap-3">
              <span>{missing} item{missing === 1 ? ' has' : 's have'} no barcode yet.</span>
              <Button size="sm" onClick={() => assign.mutate(undefined)} loading={assign.isPending}>Assign barcodes</Button>
            </div>
          </Alert>
        )}
        {assign.error && <Alert>{assign.error}</Alert>}
        <div className="grid gap-3 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-4">
          <Field label="Labels" className="sm:col-span-2">
            <Select value={layout} onChange={(e) => setLayout(e.target.value)}>
              {Object.entries(LAYOUTS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}
              <option value="roll">Label printer (one label per page)</option>
            </Select>
          </Field>
          {sheet ? (
            <Field label="Skip used labels" hint="On a part-used sheet"><Input type="number" min={0} max={perPage - 1} value={skip} onChange={(e) => setSkip(Math.max(0, Number(e.target.value)))} /></Field>
          ) : (
            <Field label="Label size (mm)"><div className="flex items-center gap-1"><Input type="number" min={20} value={roll.w} onChange={(e) => setRoll({ ...roll, w: Number(e.target.value) })} />×<Input type="number" min={10} value={roll.h} onChange={(e) => setRoll({ ...roll, h: Number(e.target.value) })} /></div></Field>
          )}
          <div className="flex items-end pb-2"><Checkbox label="Show item name" checked={showName} onChange={setShowName} /></div>
          <p className="text-xs text-slate-500 sm:col-span-4">In the print dialog, set the scale to 100% (not "fit to page") and turn off headers and footers, or the labels won't line up.</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Input placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <Button size="sm" variant="ghost" onClick={() => setCopies(Object.fromEntries(rows.map((r) => [r.key, 0])))}>None</Button>
            <Button size="sm" variant="ghost" onClick={() => setCopies({})}>Reset to stock</Button>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-slate-500"><tr><th className="py-1">Item</th><th>Barcode</th><th className="w-24">Copies</th></tr></thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.key} className="border-t">
                    <td className="py-1">{r.entry.name}</td>
                    <td className="font-mono text-xs">{r.entry.code}</td>
                    <td><Input type="number" min={0} value={r.copies} onChange={(e) => setCopies({ ...copies, [r.key]: Math.max(0, Number(e.target.value)) })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="py-4 text-center text-sm text-slate-400">No barcodes yet.</p>}
          </div>
        </div>
        <p className="text-sm text-slate-500">Preview</p>
      </div>
      <div className="flex flex-col items-center gap-6 pb-10 print:block print:p-0">
        {pages.map((p, i) => (
          <div key={i} className="sheet relative overflow-hidden bg-white shadow" style={{ width: `${pageSize[0]}mm`, height: `${pageSize[1]}mm`, breakAfter: 'page' }}>
            {p.map((entry, j) => {
              const [w, h] = sheet ? sheet.size : pageSize;
              const left = sheet ? sheet.margin[0] + (j % sheet.cols) * sheet.pitch[0] : 0;
              const top = sheet ? sheet.margin[1] + Math.floor(j / sheet.cols) * sheet.pitch[1] : 0;
              return entry && <Label key={j} entry={entry} showName={showName} style={{ left: `${left}mm`, top: `${top}mm`, width: `${w}mm`, height: `${h}mm` }} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Label({ entry, showName, style }: { entry: BarcodeEntry; showName: boolean; style: React.CSSProperties }) {
  const svg = useMemo(() => code128Svg(entry.code), [entry.code]);
  return (
    <div className="absolute flex flex-col items-center justify-center overflow-hidden px-[1.5mm] py-[1mm] text-black" style={style}>
      <div className="w-full flex-1" style={{ minHeight: 0 }}><div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /></div>
      <div className="font-mono font-semibold leading-tight" style={{ fontSize: '2.6mm' }}>{entry.code}</div>
      {showName && <div className="w-full truncate text-center leading-tight" style={{ fontSize: '2.1mm' }}>{entry.name}</div>}
    </div>
  );
}
