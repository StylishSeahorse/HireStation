import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { Button, Card, PageHeader, Spinner, StatusBadge, Table, Td } from '@/components/ui';

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard') });
  const { dateTime, money } = useFormat();
  if (isLoading) return <Spinner />;
  const stats = [
    ['Loading in this week', data.upcoming.length],
    ['Contracts awaiting signature', data.unsignedContracts],
    ['Overdue returns', data.unreturned.length],
    ['Bonds held', `${data.bondsHeld.count} · ${money(data.bondsHeld.total)}`],
    ['Outstanding invoices', money(data.outstanding)],
  ];
  return (
    <>
      <PageHeader title="Dashboard" actions={<Link to="/bookings/new"><Button>New booking</Button></Link>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stats.map(([k, v]) => <div key={k} className="rounded-lg border bg-white p-4"><div className="text-xs text-slate-500">{k}</div><div className="mt-1 text-lg font-semibold">{v}</div></div>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Next 7 days">
          <Table head={['Booking', 'Client', 'Load-in', 'Status']} empty="Nothing loading in this week.">
            {data.upcoming.map((b: any) => <tr key={b.id}><Td><Link className="text-brand-accent hover:underline" to={`/bookings/${b.id}`}>{b.reference}</Link> {b.title}</Td><Td>{b.client.name}</Td><Td>{dateTime(b.loadIn)}</Td><Td><StatusBadge status={b.status} /></Td></tr>)}
          </Table>
        </Card>
        <Card title="Overdue returns">
          <Table head={['Booking', 'Client', 'Due back']} empty="All gear is accounted for.">
            {data.unreturned.map((b: any) => <tr key={b.id}><Td><Link className="text-brand-accent hover:underline" to={`/bookings/${b.id}`}>{b.reference}</Link> {b.title}</Td><Td>{b.client.name}</Td><Td className="text-rose-600">{dateTime(b.loadOut)}</Td></tr>)}
          </Table>
        </Card>
      </div>
    </>
  );
}
