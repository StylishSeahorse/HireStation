export class IntegrationError extends Error {
  constructor(public service: string, message: string, public status?: number, public body?: unknown) {
    super(`${service}: ${message}`);
  }
}

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

export async function requestJson<T>(service: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw new IntegrationError(service, `could not reach ${new URL(url).host} (${(e as Error).message})`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (body as { message?: string })?.message ?? (body as { error?: string })?.error ?? res.statusText;
    throw new IntegrationError(service, `HTTP ${res.status}: ${msg}`, res.status, body);
  }
  return body as T;
}
