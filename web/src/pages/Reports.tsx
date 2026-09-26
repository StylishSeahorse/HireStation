import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { Card, Field, Input, PageHeader, Table, Td } from '@/components/ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Reports() {
  const now = new Date();
  const [start, setStart] = useState(iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)));
  const [end, setEnd] = useState(iso(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
  const { money, date } = useFormat();
  const q = `start=${start}&end=${end}`;
  const revenue = useQuery({ queryKey: ['rep-rev', q], queryFn: () => api(`/reports/revenue?${q}`) });
  const util = useQuery({ queryKey: ['rep-util', q], queryFn: () => api(`/reports/utilisation?${q}`) });
  const bonds = useQuery({ queryKey: ['rep-bonds'], queryFn: () => api('/reports/bonds') });
  const max = Math.max(1, ...(revenue.data ?? []).map((r: any) => r.total));
  const tot = (revenue.data ?? []).reduce((a: any, r: any) => ({ s: a.s + r.subtotal, g: a.g + r.gst, t: a.t + r.total, p: a.p + r.paid }), { s: 0, g: 0, t: 0, p: 0 });
  return (
    <>
      <PageHeader title="Reports" actions={<div className="flex gap-2"><Field label="From"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="To"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>} />
      <div className="space-y-6">
        <Card title="Revenue by month (invoiced)">
          <Table head={['Month', '', 'Ex GST', 'GST', 'Total', 'Paid']} empty="No invoices in this period.">
            {revenue.data?.map((r: any) => (
              <tr key={r.month}><Td>{r.month}</Td><Td className="w-1/3"><div className="h-3 rounded bg-brand-accent" style={{ width: `${(r.total / max) * 100}%` }} /></Td><Td>{money(r.subtotal)}</Td><Td>{money(r.gst)}</Td><Td className="font-medium">{money(r.total)}</Td><Td>{money(r.paid)}</Td></tr>
            ))}
            {revenue.data?.length > 0 && <tr className="font-semibold"><Td>Total</Td><Td /><Td>{money(tot.s)}</Td><Td>{money(tot.g)}</Td><Td>{money(tot.t)}</Td><Td>{money(tot.p)}</Td></tr>}
          </Table>
        </Card>
        <Card title="Equipment utilisation (booked unit-days ÷ available unit-days)">
          <Table head={['Item', 'Stock', 'Bookings', 'Unit-days', 'Utilisation', 'Hire value']}>
            {util.data?.map((u: any) => (
              <tr key={u.id}><Td><Link to={`/equipment/${u.id}`}>{u.name}</Link></Td><Td>{u.stock}</Td><Td>{u.bookings}</Td><Td>{u.unitDays}</Td>
                <Td><div className="flex items-center gap-2"><div className="h-2 w-24 rounded bg-slate-100"><div className="h-2 rounded bg-brand-accent" style={{ width: `${u.utilisation * 100}%` }} /></div>{Math.round(u.utilisation * 100)}%</div></Td><Td>{money(u.revenue)}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Outstanding bonds">
          <Table head={['Booking', 'Client', 'Returned by', 'Bond', 'Forfeited', 'Status']} empty="No bonds outstanding.">
            {bonds.data?.map((b: any) => <tr key={b.id}><Td><Link to={`/bookings/${b.id}`} className="text-brand-accent">{b.reference}</Link> {b.title}</Td><Td>{b.client.name}</Td><Td>{date(b.loadOut)}</Td><Td>{money(b.bondAmount)}</Td><Td>{money(b.bondForfeited)}</Td><Td>{b.bondStatus.replace('_', ' ').toLowerCase()}</Td></tr>)}
          </Table>
        </Card>
      </div>
    </>
  );
}
