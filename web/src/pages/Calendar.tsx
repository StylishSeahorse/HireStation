import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import { api } from '@/lib/api';
import { STATUS_META } from '@/lib/format';
import { useSettings } from '@/lib/hooks';
import { Card, Checkbox, PageHeader } from '@/components/ui';

export default function CalendarPage() {
  const nav = useNavigate();
  const { data: s } = useSettings();
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const bookings = useQuery({ queryKey: ['bookings-cal', range], queryFn: () => api(`/bookings?start=${range!.start}&end=${range!.end}`), enabled: !!range });
  const conflicts = useQuery({ queryKey: ['calendar-conflicts', range], queryFn: () => api(`/calendar?start=${range!.start}&end=${range!.end}`), enabled: !!range });
  const clash = new Set<string>((conflicts.data?.overbooked ?? []).flatMap((o: any) => o.bookings));
  const events = (bookings.data ?? []).filter((b: any) => showCancelled || b.status !== 'CANCELLED').map((b: any) => ({
    id: b.id, title: `${clash.has(b.id) ? '⚠ ' : ''}${b.reference} ${b.title} — ${b.client.name}`, start: b.loadIn, end: b.loadOut,
    backgroundColor: STATUS_META[b.status]?.colour, borderColor: clash.has(b.id) ? '#e11d48' : STATUS_META[b.status]?.colour,
  }));
  return (
    <>
      <PageHeader title="Calendar" actions={<Checkbox label="Show cancelled" checked={showCancelled} onChange={setShowCancelled} />} />
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {Object.entries(STATUS_META).map(([k, m]) => <span key={k} className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded" style={{ background: m.colour }} />{m.label}</span>)}
        <span className="inline-flex items-center gap-1">⚠ equipment over-allocated</span>
      </div>
      <Card>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
          initialView="dayGridMonth"
          timeZone={s?.timezone ?? 'local'}
          firstDay={1}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listMonth' }}
          height="auto"
          events={events}
          datesSet={(a) => setRange({ start: a.start.toISOString(), end: a.end.toISOString() })}
          eventClick={(a) => nav(`/bookings/${a.event.id}`)}
          dateClick={() => nav('/bookings/new')}
        />
      </Card>
    </>
  );
}
