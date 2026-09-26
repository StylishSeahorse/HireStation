import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, Box, CalendarDays, ClipboardList, FileSignature, LayoutDashboard, LogOut, Menu, Search, Settings, Users, UserCog, BarChart3, CalendarCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe, useSettings } from '@/lib/hooks';
import { useFormat } from '@/lib/format';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/bookings', label: 'Bookings', icon: ClipboardList },
  { to: '/equipment', label: 'Equipment', icon: Box },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/staff', label: 'Staff', icon: UserCog },
  { to: '/my-schedule', label: 'My schedule', icon: CalendarCheck },
  { to: '/contracts', label: 'Contracts', icon: FileSignature },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data: me } = useMe();
  const { data: s } = useSettings();
  const qc = useQueryClient();
  return (
    <div className="min-h-screen lg:flex">
      <aside className={clsx('fixed inset-y-0 left-0 z-40 w-60 transform bg-brand text-white transition lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-4">
          {s?.logoUrl ? <img src={s.logoUrl} alt="" className="h-9 max-w-24 rounded bg-white object-contain p-0.5" /> : null}
          <span className="truncate font-semibold">{s?.tradingName || s?.legalName}</span>
        </div>
        <nav className="space-y-0.5 p-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
              className={({ isActive }) => clsx('flex items-center gap-3 rounded-md px-3 py-2 text-sm', isActive ? 'bg-white/15 font-medium' : 'text-white/80 hover:bg-white/10')}>
              <Icon size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-white/10 p-3 text-xs text-white/70">
          <div className="truncate">{me?.name} · {me?.role?.replace('_', ' ').toLowerCase()}</div>
          <button className="mt-1 inline-flex items-center gap-1 hover:text-white" onClick={async () => { await api('/auth/logout', { method: 'POST' }); qc.clear(); location.assign('/'); }}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-white px-4">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu /></button>
          <GlobalSearch />
          <Notifications />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { date } = useFormat();
  const { data } = useQuery({ queryKey: ['search', q], queryFn: () => api(`/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const go = (to: string) => { setOpen(false); setQ(''); nav(to); };
  const has = data && (data.equipment.length || data.clients.length || data.bookings.length);
  return (
    <div ref={ref} className="relative max-w-xl flex-1">
      <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search equipment, clients, bookings…"
        className="w-full rounded-md border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:bg-white focus:outline-none" />
      {open && q.length >= 2 && (
        <div className="absolute mt-1 w-full rounded-md border bg-white py-1 text-sm shadow-lg">
          {!has && <p className="px-3 py-2 text-slate-400">No matches</p>}
          {data?.bookings.map((b: any) => <button key={b.id} onClick={() => go(`/bookings/${b.id}`)} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"><span className="text-xs text-slate-400">Booking</span> {b.reference} — {b.title} <span className="text-slate-400">{date(b.loadIn)}</span></button>)}
          {data?.clients.map((c: any) => <button key={c.id} onClick={() => go(`/clients/${c.id}`)} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"><span className="text-xs text-slate-400">Client</span> {c.name}</button>)}
          {data?.equipment.map((e: any) => <button key={e.id} onClick={() => go(`/equipment/${e.id}`)} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"><span className="text-xs text-slate-400">Equipment</span> {e.name}</button>)}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { dateTime } = useFormat();
  const { data = [] } = useQuery({ queryKey: ['notifications'], queryFn: () => api<any[]>('/notifications'), refetchInterval: 60_000 });
  const unread = data.filter((n) => !n.read).length;
  return (
    <div className="relative ml-auto">
      <button className="relative rounded p-2 hover:bg-slate-100" aria-label="Notifications"
        onClick={async () => { setOpen(!open); if (!open && unread) { await api('/notifications/read', { method: 'POST' }); qc.invalidateQueries({ queryKey: ['notifications'] }); } }}>
        <Bell size={19} />
        {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 max-h-96 w-80 overflow-y-auto rounded-md border bg-white shadow-lg">
          {data.length === 0 && <p className="p-4 text-sm text-slate-400">No notifications</p>}
          {data.map((n) => (
            <Link key={n.id} to={n.bookingId ? `/bookings/${n.bookingId}` : '#'} onClick={() => setOpen(false)} className="block border-b px-3 py-2 text-sm hover:bg-slate-50">
              <div>{n.message}</div><div className="text-xs text-slate-400">{dateTime(n.createdAt)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
