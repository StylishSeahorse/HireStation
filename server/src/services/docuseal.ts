import { IntegrationError, joinUrl, requestJson } from './http.js';

// Minimal Docuseal API client. Credentials come from the BusinessProfile row.
export interface DsConfig { url: string; token: string }

export interface DsSubmitter { id: number; submission_id?: number; slug?: string; email?: string; status?: string }

export class Docuseal {
  constructor(private cfg: DsConfig) {}

  private req<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Self-hosted Docuseal serves its API under /api.
    return requestJson<T>('Docuseal', joinUrl(this.cfg.url, `/api${path}`), {
      method,
      headers: { 'X-Auth-Token': this.cfg.token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: 30_000,
    });
  }

  async listTemplates(): Promise<{ id: number; name: string }[]> {
    const res = await this.req<{ data?: { id: number; name: string }[] } | { id: number; name: string }[]>('GET', '/templates?limit=100');
    const list = Array.isArray(res) ? res : res?.data;
    if (!Array.isArray(list)) throw new IntegrationError('Docuseal', 'unexpected response — is this a Docuseal URL?');
    return list.map((t) => ({ id: t.id, name: t.name }));
  }

  /**
   * Pro vs free edition. The free edition doesn't route /api/submissions/html at all and answers
   * with a "Pro Edition" 404; Pro rejects this empty body as invalid. Nothing is created either way.
   */
  async detectEdition(): Promise<'pro' | 'free'> {
    try {
      await this.req('POST', '/submissions/html', {});
      return 'pro';
    } catch (e) {
      if (e instanceof IntegrationError && isProOnlyError(e)) return 'free';
      if (e instanceof IntegrationError && e.status && e.status >= 400 && e.status < 500) return 'pro';
      throw e;
    }
  }

  /** Send merged HTML contract content for signing (Pro edition). Docuseal emails the signer. */
  async submitHtml(opts: { name: string; html: string; signer: { name: string; email: string }; message?: { subject: string; body: string } }): Promise<{ submissionId: number; slug?: string }> {
    const res = await this.req<unknown>('POST', '/submissions/html', {
      name: opts.name,
      send_email: true,
      documents: [{ name: opts.name, html: opts.html }],
      submitters: [{ role: 'Client', name: opts.signer.name, email: opts.signer.email }],
      ...(opts.message ? { message: opts.message } : {}),
    });
    return parseSubmission(res);
  }

  /** Create a submission from a pre-built Docuseal template, prefilling fields named after merge keys. */
  async submitTemplate(opts: { templateId: number; signer: { name: string; email: string }; values: Record<string, string>; message?: { subject: string; body: string } }): Promise<{ submissionId: number; slug?: string }> {
    // Only the first (client) role is filled; prefilled values are locked so the signer can't alter
    // prices or terms. Values for names the template doesn't have are ignored by Docuseal.
    const res = await this.req<unknown>('POST', '/submissions', {
      template_id: opts.templateId,
      send_email: true,
      ...(opts.message ? { message: opts.message } : {}),
      submitters: [{ name: opts.signer.name, email: opts.signer.email, values: opts.values, readonly_fields: Object.keys(opts.values) }],
    });
    return parseSubmission(res);
  }

  /**
   * Top-align a (tall) text field so its text starts at the top of the box. PDF import can't carry
   * vertical alignment, and Docuseal centres by default. Returns false when there's no such field.
   */
  async topAlignField(templateId: number, fieldName: string): Promise<boolean> {
    const t = await this.req<{ fields?: { name?: string; preferences?: Record<string, unknown> }[] }>('GET', `/templates/${templateId}`);
    const fields = t.fields ?? [];
    const f = fields.find((x) => x.name?.toLowerCase() === fieldName.toLowerCase());
    if (!f) return false;
    if (f.preferences?.valign === 'top') return true;
    f.preferences = { ...f.preferences, valign: 'top' };
    await this.req('PUT', `/templates/${templateId}`, { fields });
    return true;
  }

  async getDocuments(submissionId: number | string): Promise<{ name: string; url: string }[]> {
    const res = await this.req<{ documents?: { name: string; url: string }[] }>('GET', `/submissions/${submissionId}/documents?merge=true`);
    return res.documents ?? [];
  }

  async remind(submitterId: number | string): Promise<void> {
    await this.req('PUT', `/submitters/${submitterId}`, { send_email: true });
  }
}

export function isProOnlyError(e: IntegrationError) {
  return e.status === 404 && /Pro Edition/i.test(e.message + JSON.stringify(e.body ?? ''));
}

function parseSubmission(res: unknown): { submissionId: number; slug?: string } {
  const first = (Array.isArray(res) ? res[0] : (res as { submitters?: DsSubmitter[] })?.submitters?.[0]) as DsSubmitter | undefined;
  const id = (res as { id?: number })?.id && !Array.isArray(res) ? (res as { id: number }).id : first?.submission_id;
  if (!id) throw new IntegrationError('Docuseal', 'submission response did not include an id', undefined, res);
  return { submissionId: id, slug: first?.slug };
}
