// Australian identifier validation helpers.

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function normaliseDigits(v: string): string {
  return v.replace(/\D/g, '');
}

/** ABN checksum per ABR algorithm: subtract 1 from first digit, weighted sum mod 89 === 0. */
export function isValidAbn(input: string): boolean {
  const abn = normaliseDigits(input);
  if (abn.length !== 11) return false;
  const digits = abn.split('').map(Number);
  digits[0] -= 1;
  if (digits[0] < 0) return false;
  const sum = digits.reduce((acc, d, i) => acc + d * ABN_WEIGHTS[i], 0);
  return sum % 89 === 0;
}

export function formatAbn(input: string): string {
  const a = normaliseDigits(input);
  return a.length === 11 ? `${a.slice(0, 2)} ${a.slice(2, 5)} ${a.slice(5, 8)} ${a.slice(8)}` : input;
}

const ACN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 1];

export function isValidAcn(input: string): boolean {
  const acn = normaliseDigits(input);
  if (acn.length !== 9) return false;
  const d = acn.split('').map(Number);
  const sum = ACN_WEIGHTS.reduce((acc, w, i) => acc + w * d[i], 0);
  const check = (10 - (sum % 10)) % 10;
  return check === d[8];
}

export function isValidBsb(input: string): boolean {
  return /^\d{3}-?\d{3}$/.test(input.trim());
}

export function formatBsb(input: string): string {
  const d = normaliseDigits(input);
  return d.length === 6 ? `${d.slice(0, 3)}-${d.slice(3)}` : input;
}

export function isValidAccountNumber(input: string): boolean {
  return /^\d{4,10}$/.test(normaliseDigits(input)) && normaliseDigits(input) === input.replace(/[\s-]/g, '');
}
