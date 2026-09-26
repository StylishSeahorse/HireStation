import { useSettings } from './hooks';

export const STATUS_META: Record<string, { label: string; colour: string }> = {
  ENQUIRY: { label: 'Enquiry', colour: '#94a3b8' },
  QUOTED: { label: 'Quoted', colour: '#60a5fa' },
  CONFIRMED: { label: 'Confirmed', colour: '#2563eb' },
  CONTRACT_SENT: { label: 'Contract sent', colour: '#a855f7' },
  CONTRACT_VIEWED: { label: 'Contract viewed', colour: '#c084fc' },
  CONTRACT_SIGNED: { label: 'Contract signed', colour: '#7c3aed' },
  CONTRACT_DECLINED: { label: 'Contract declined', colour: '#e11d48' },
  INVOICED: { label: 'Invoiced', colour: '#f59e0b' },
  PAID: { label: 'Paid', colour: '#16a34a' },
  COMPLETED: { label: 'Completed', colour: '#0f766e' },
  CANCELLED: { label: 'Cancelled', colour: '#6b7280' },
};

/** Formatters bound to the business's configured locale settings (never assumed). */
export function useFormat() {
  const { data: s } = useSettings();
  const tz = s?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currency = s?.currency ?? 'AUD';
  const pattern = s?.dateFormat ?? 'DD/MM/YYYY';
  const date = (v: string | Date | null | undefined) => {
    if (!v) return '';
    const parts = new Intl.DateTimeFormat('en-AU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(v));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return pattern.replace('DD', g('day')).replace('MM', g('month')).replace('YYYY', g('year'));
  };
  const time = (v: string | Date) => new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(v));
  const dateTime = (v: string | Date | null | undefined) => (v ? `${date(v)} ${time(v)}` : '');
  const money = (v: number | string | null | undefined) => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(v ?? 0));
  const cents = (c: number) => money(c / 100);
  return { date, time, dateTime, money, cents, tz };
}

/** Convert an ISO instant to the value for <input type="datetime-local"> in the business timezone. */
export function toLocalInput(iso: string | null | undefined, tz: string) {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** Interpret a datetime-local value as wall-clock time in the business timezone. */
export function fromLocalInput(v: string, tz: string): string {
  if (!v) return '';
  const asUtc = new Date(`${v}:00Z`);
  const shown = new Date(toLocalInput(asUtc.toISOString(), tz) + ':00Z');
  return new Date(asUtc.getTime() - (shown.getTime() - asUtc.getTime())).toISOString();
}
