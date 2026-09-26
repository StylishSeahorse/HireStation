import { describe, it, expect } from 'vitest';
import { fromLocalInput, toLocalInput } from './format';
import { formatAbn, isValidAbn } from './au';

describe('business-timezone datetime inputs', () => {
  it('round-trips wall-clock time in Brisbane (no DST)', () => {
    const iso = fromLocalInput('2026-07-01T08:00', 'Australia/Brisbane');
    expect(iso).toBe('2026-06-30T22:00:00.000Z');
    expect(toLocalInput(iso, 'Australia/Brisbane')).toBe('2026-07-01T08:00');
  });

  it('respects daylight saving in Sydney', () => {
    expect(fromLocalInput('2026-01-15T08:00', 'Australia/Sydney')).toBe('2026-01-14T21:00:00.000Z'); // AEDT +11
    expect(fromLocalInput('2026-07-15T08:00', 'Australia/Sydney')).toBe('2026-07-14T22:00:00.000Z'); // AEST +10
  });

  it('handles empty values', () => {
    expect(toLocalInput(null, 'UTC')).toBe('');
    expect(fromLocalInput('', 'UTC')).toBe('');
  });
});

describe('ABN helpers', () => {
  it('validates and formats', () => {
    expect(isValidAbn('51824753556')).toBe(true);
    expect(isValidAbn('51824753557')).toBe(false);
    expect(formatAbn('51824753556')).toBe('51 824 753 556');
  });
});
