/** Number of chargeable hire days between two instants (minimum 1, partial days round up). */
export function hireDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 1;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export function formatDate(d: Date, pattern: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return pattern.replace('DD', get('day')).replace('MM', get('month')).replace('YYYY', get('year'));
}

export function formatDateTime(d: Date, pattern: string, timeZone: string): string {
  const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d);
  return `${formatDate(d, pattern, timeZone)} ${time}`;
}
