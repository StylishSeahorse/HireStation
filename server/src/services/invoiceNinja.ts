import { IntegrationError, joinUrl, requestJson } from './http.js';

// Minimal Invoice Ninja v5 REST client. Credentials always come from the
// BusinessProfile row (or from the setup wizard's test step) — never env/code.

export interface InConfig { url: string; token: string }

export interface InInvoice {
  id: string;
  number: string;
  status_id: string;
  amount: number;
  balance: number;
  paid_to_date: number;
  total_taxes: number;
  client_id: string;
  invitations?: { link?: string; key?: string }[];
}

export interface InLineItem {
  product_key: string;
  notes: string;
  cost: number;
  quantity: number;
  tax_name1: string;
  tax_rate1: number;
  type_id?: string;
}

export class InvoiceNinja {
  constructor(private cfg: InConfig) {}

  private req<T>(method: string, path: string, body?: unknown): Promise<T> {
    return requestJson<T>('Invoice Ninja', joinUrl(this.cfg.url, `/api/v1${path}`), {
      method,
      headers: {
        'X-API-TOKEN': this.cfg.token,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async listCompanies(): Promise<{ id: string; name: string }[]> {
    const res = await this.req<{ data: { id: string; settings?: { name?: string } }[] }>('GET', '/companies');
    if (!Array.isArray(res?.data)) throw new IntegrationError('Invoice Ninja', 'unexpected response — is this an Invoice Ninja v5 URL?');
    return res.data.map((c) => ({ id: c.id, name: c.settings?.name || c.id }));
  }

  async findClient(email?: string | null, abn?: string | null): Promise<string | null> {
    const tries: string[] = [];
    if (email) tries.push(`email=${encodeURIComponent(email)}`);
    if (abn) tries.push(`filter=${encodeURIComponent(abn)}`);
    for (const q of tries) {
      const res = await this.req<{ data: { id: string; vat_number?: string; is_deleted?: boolean; contacts?: { email?: string }[] }[] }>('GET', `/clients?${q}&per_page=50`);
      const match = res.data.find((c) => !c.is_deleted && (
        (email && c.contacts?.some((ct) => ct.email?.toLowerCase() === email.toLowerCase())) ||
        (abn && c.vat_number?.replace(/\D/g, '') === abn.replace(/\D/g, ''))
      ));
      if (match) return match.id;
    }
    return null;
  }

  async createClient(c: { name: string; contactName?: string | null; email?: string | null; phone?: string | null; abn?: string | null; address?: string | null }): Promise<string> {
    const [first, ...rest] = (c.contactName || c.name).split(' ');
    const res = await this.req<{ data: { id: string } }>('POST', '/clients', {
      name: c.name,
      vat_number: c.abn ?? '',
      phone: c.phone ?? '',
      address1: c.address ?? '',
      contacts: [{ first_name: first, last_name: rest.join(' '), email: c.email ?? '', phone: c.phone ?? '', send_email: true }],
    });
    return res.data.id;
  }

  createInvoice(payload: { client_id: string; line_items: InLineItem[]; public_notes?: string; po_number?: string; date?: string }): Promise<{ data: InInvoice }> {
    return this.req('POST', '/invoices', { ...payload, uses_inclusive_taxes: false });
  }

  updateInvoice(id: string, payload: { line_items: InLineItem[]; public_notes?: string }): Promise<{ data: InInvoice }> {
    return this.req('PUT', `/invoices/${id}`, payload);
  }

  getInvoice(id: string): Promise<{ data: InInvoice }> {
    return this.req('GET', `/invoices/${id}?include=invitations`);
  }

  createCredit(payload: { client_id: string; line_items: InLineItem[]; public_notes?: string }): Promise<{ data: InInvoice }> {
    return this.req('POST', '/credits', { ...payload, uses_inclusive_taxes: false });
  }

  getPayment(id: string): Promise<{ data: { id: string; invoices?: { invoice_id: string }[]; paymentables?: { invoice_id?: string }[] } }> {
    return this.req('GET', `/payments/${id}?include=paymentables`);
  }

  /** Subscribe Invoice Ninja webhooks to this app. Event ids: 2=create invoice, 8=update invoice, 4=create payment. */
  async registerWebhooks(targetUrl: string, headers: Record<string, string>): Promise<void> {
    const existing = await this.req<{ data: { id: string; target_url: string; event_id: string }[] }>('GET', '/webhooks');
    for (const event_id of ['2', '4', '8']) {
      const body = { target_url: targetUrl, event_id, format: 'JSON', rest_method: 'post', headers };
      const found = existing.data.find((w) => w.target_url === targetUrl && String(w.event_id) === event_id);
      // Update existing subscriptions so a rotated secret header takes effect.
      if (found) await this.req('PUT', `/webhooks/${found.id}`, body);
      else await this.req('POST', '/webhooks', body);
    }
  }
}

export const IN_STATUS: Record<string, 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'CANCELLED'> = {
  '1': 'DRAFT', '2': 'SENT', '3': 'PARTIAL', '4': 'PAID', '5': 'CANCELLED', '6': 'CANCELLED',
};
