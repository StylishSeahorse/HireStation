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

  /** Send merged HTML contract content for signing. Docuseal emails the signer. */
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
  async submitTemplate(opts: { templateId: number; signer: { name: string; email: string }; values: Record<string, string> }): Promise<{ submissionId: number; slug?: string }> {
    const res = await this.req<unknown>('POST', '/submissions', {
      template_id: opts.templateId,
      send_email: true,
      submitters: [{ role: 'Client', name: opts.signer.name, email: opts.signer.email, values: opts.values }],
    });
    return parseSubmission(res);
  }

  async getDocuments(submissionId: number | string): Promise<{ name: string; url: string }[]> {
    const res = await this.req<{ documents?: { name: string; url: string }[] }>('GET', `/submissions/${submissionId}/documents?merge=true`);
    return res.documents ?? [];
  }

  async remind(submitterId: number | string): Promise<void> {
    await this.req('PUT', `/submitters/${submitterId}`, { send_email: true });
  }
}

function parseSubmission(res: unknown): { submissionId: number; slug?: string } {
  const first = (Array.isArray(res) ? res[0] : (res as { submitters?: DsSubmitter[] })?.submitters?.[0]) as DsSubmitter | undefined;
  const id = (res as { id?: number })?.id && !Array.isArray(res) ? (res as { id: number }).id : first?.submission_id;
  if (!id) throw new IntegrationError('Docuseal', 'submission response did not include an id', undefined, res);
  return { submissionId: id, slug: first?.slug };
}
