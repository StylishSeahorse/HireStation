const W = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
export function isValidAbn(v: string) {
  const d = v.replace(/\D/g, '').split('').map(Number);
  if (d.length !== 11) return false;
  d[0] -= 1;
  return d[0] >= 0 && d.reduce((a, x, i) => a + x * W[i], 0) % 89 === 0;
}
export const formatAbn = (v?: string | null) => {
  const a = (v ?? '').replace(/\D/g, '');
  return a.length === 11 ? `${a.slice(0, 2)} ${a.slice(2, 5)} ${a.slice(5, 8)} ${a.slice(8)}` : v ?? '';
};
export const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
export const TIMEZONES = ['Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Hobart', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Perth', 'Australia/Lord_Howe', 'Australia/Broken_Hill', 'Pacific/Auckland', 'UTC'];
