export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) { super(message); }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 409 && body?.setupRequired && !location.pathname.startsWith('/setup')) location.assign('/setup');
    const msg = body?.issues?.length ? body.issues.map((i: any) => `${i.path ? i.path + ': ' : ''}${i.message}`).join('; ') : body?.error ?? res.statusText;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
