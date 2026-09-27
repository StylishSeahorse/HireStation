import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { AU_STATES, TIMEZONES, isValidAbn } from '@/lib/au';
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from './ui';

export type Draft = Record<string, any>;
type FormProps = { value: Draft; onChange: (v: Draft) => void; existing?: boolean };
const set = (p: FormProps, k: string) => (e: { target: { value: string } }) => p.onChange({ ...p.value, [k]: e.target.value });

export function IdentityForm(p: FormProps) {
  const v = p.value;
  const [lookup, setLookup] = useState<{ busy?: boolean; error?: string; names?: string[] }>({});
  const abnOk = !v.abn || isValidAbn(v.abn);
  const doLookup = async () => {
    setLookup({ busy: true });
    try {
      const r = await api('/setup/abn-lookup', { body: { abn: v.abn, guid: v.abrGuid || undefined } });
      p.onChange({ ...v, legalName: v.legalName || r.entityName, state: r.state || v.state, postcode: r.postcode || v.postcode, tradingName: v.tradingName || r.businessNames?.[0] || '' });
      setLookup({ names: r.businessNames });
    } catch (e) { setLookup({ error: errorText(e) }); }
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Legal business name"><Input value={v.legalName ?? ''} onChange={set(p, 'legalName')} /></Field>
      <Field label="Trading name" hint="Shown on documents if set"><Input value={v.tradingName ?? ''} onChange={set(p, 'tradingName')} /></Field>
      <Field label="Business structure">
        <Select value={v.structure ?? ''} onChange={set(p, 'structure')}>
          <option value="">Select…</option>
          <option value="SOLE_TRADER">Sole trader</option><option value="PARTNERSHIP">Partnership</option>
          <option value="COMPANY">Company</option><option value="TRUST">Trust</option>
        </Select>
      </Field>
      <Field label="ABN" error={abnOk ? undefined : 'ABN checksum is invalid'}>
        <div className="flex gap-2">
          <Input value={v.abn ?? ''} onChange={set(p, 'abn')} placeholder="11 digits" />
          <Button type="button" variant="secondary" onClick={doLookup} loading={lookup.busy} disabled={!v.abn || !abnOk || (!v.abrGuid && !p.existing)}>Look up</Button>
        </div>
      </Field>
      {(v.structure === 'COMPANY' || v.acn) && <Field label="ACN" hint="Only if incorporated"><Input value={v.acn ?? ''} onChange={set(p, 'acn')} /></Field>}
      <Field label="ABN Lookup GUID (optional)" hint={<>Enables the “Look up” autofill. Register free at abr.business.gov.au{p.existing ? ' — leave blank to keep the saved GUID' : ''}.</>}>
        <Input value={v.abrGuid ?? ''} onChange={set(p, 'abrGuid')} type="password" autoComplete="off" />
      </Field>
      {lookup.error && <div className="sm:col-span-2"><Alert tone="amber">ABN lookup failed: {lookup.error}. You can fill the details in manually.</Alert></div>}
      {lookup.names && lookup.names.length > 1 && <div className="sm:col-span-2"><Alert tone="blue">Registered business names: {lookup.names.join(', ')}</Alert></div>}
      <Field label="Address line 1" className="sm:col-span-2"><Input value={v.addressLine1 ?? ''} onChange={set(p, 'addressLine1')} /></Field>
      <Field label="Address line 2" className="sm:col-span-2"><Input value={v.addressLine2 ?? ''} onChange={set(p, 'addressLine2')} /></Field>
      <Field label="Suburb"><Input value={v.suburb ?? ''} onChange={set(p, 'suburb')} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="State"><Select value={v.state ?? ''} onChange={set(p, 'state')}><option value="">—</option>{AU_STATES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Postcode"><Input value={v.postcode ?? ''} onChange={set(p, 'postcode')} maxLength={4} /></Field>
      </div>
      <Field label="Contact email"><Input type="email" value={v.contactEmail ?? ''} onChange={set(p, 'contactEmail')} /></Field>
      <Field label="Contact phone"><Input value={v.contactPhone ?? ''} onChange={set(p, 'contactPhone')} /></Field>
      <Field label="Contract signatory name"><Input value={v.signatoryName ?? ''} onChange={set(p, 'signatoryName')} /></Field>
      <Field label="Signatory title"><Input value={v.signatoryTitle ?? ''} onChange={set(p, 'signatoryTitle')} placeholder="e.g. Director" /></Field>
    </div>
  );
}

export function TaxForm(p: FormProps) {
  const v = p.value;
  return (
    <div className="space-y-4">
      <Checkbox label="Registered for GST" checked={!!v.gstRegistered} onChange={(c) => p.onChange({ ...v, gstRegistered: c })} />
      <Field label="GST rate (%)" hint="Pre-filled with the current standard rate; all pricing reads this setting.">
        <Input type="number" step="0.01" min="0" max="100" className="max-w-32" value={v.gstRate ?? ''} onChange={set(p, 'gstRate')} disabled={!v.gstRegistered} />
      </Field>
      {!v.gstRegistered && <Alert tone="amber">Invoices will not include GST, and will not be labelled “Tax Invoice”.</Alert>}
    </div>
  );
}

export function BankingForm(p: FormProps) {
  const v = p.value;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="BSB" hint="XXX-XXX"><Input value={v.bankBsb ?? ''} onChange={set(p, 'bankBsb')} maxLength={7} /></Field>
      <Field label="Account number"><Input value={v.bankAccountNumber ?? ''} onChange={set(p, 'bankAccountNumber')} /></Field>
      <Field label="Account name"><Input value={v.bankAccountName ?? ''} onChange={set(p, 'bankAccountName')} /></Field>
      <p className="text-xs text-slate-500 sm:col-span-3">Used for bond refund instructions and merged into contracts.</p>
    </div>
  );
}

export function BrandingForm(p: FormProps & { logoUrl?: string | null; onLogo: (f: File) => Promise<void>; onRemoveLogo?: () => void }) {
  const v = p.value;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Logo" className="sm:col-span-2" hint="PNG, JPEG, WebP or SVG">
        <div className="flex items-center gap-4">
          {p.logoUrl ? <img src={p.logoUrl} alt="Logo" className="h-16 max-w-48 rounded border bg-white object-contain p-1" /> : <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed text-xs text-slate-400">No logo</div>}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="text-sm" disabled={busy}
            onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); setErr(''); try { await p.onLogo(f); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); } }} />
          {p.logoUrl && p.onRemoveLogo && <Button type="button" size="sm" variant="ghost" onClick={p.onRemoveLogo}>Remove</Button>}
        </div>
        {err && <p className="text-xs text-rose-600">{err}</p>}
      </Field>
      {(['primaryColour', 'accentColour'] as const).map((k) => (
        <Field key={k} label={k === 'primaryColour' ? 'Primary colour' : 'Accent colour'}>
          <div className="flex gap-2">
            <input type="color" value={v[k] || '#000000'} onChange={set(p, k)} className="h-9 w-12 rounded border" />
            <Input value={v[k] ?? ''} onChange={set(p, k)} placeholder="#rrggbb" />
          </div>
        </Field>
      ))}
      <Field label="Document footer text" className="sm:col-span-2"><Textarea value={v.documentFooter ?? ''} onChange={set(p, 'documentFooter')} /></Field>
    </div>
  );
}

export function InvoiceNinjaForm(p: FormProps & { hasToken?: boolean }) {
  const v = p.value;
  const [state, setState] = useState<{ busy?: boolean; error?: string; companies?: { id: string; name: string }[] }>({});
  const test = async () => {
    setState({ busy: true });
    try {
      const r = await api('/setup/test/invoice-ninja', { body: { url: v.invoiceNinjaUrl, token: v.invoiceNinjaToken || undefined } });
      const only = r.companies.length === 1 ? r.companies[0].id : v.invoiceNinjaCompanyId;
      p.onChange({ ...v, invoiceNinjaCompanyId: only, _tested: true });
      setState({ companies: r.companies });
    } catch (e) { setState({ error: errorText(e) }); p.onChange({ ...v, _tested: false }); }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice Ninja URL" hint="e.g. https://invoicing.yourdomain"><Input value={v.invoiceNinjaUrl ?? ''} onChange={(e) => p.onChange({ ...v, invoiceNinjaUrl: e.target.value, _tested: false })} /></Field>
        <Field label="API token" hint={p.hasToken ? 'Leave blank to keep the saved token' : 'Settings → Account Management → API Tokens'}>
          <Input type="password" autoComplete="off" value={v.invoiceNinjaToken ?? ''} onChange={(e) => p.onChange({ ...v, invoiceNinjaToken: e.target.value, _tested: false })} />
        </Field>
      </div>
      <Button type="button" variant="secondary" onClick={test} loading={state.busy} disabled={!v.invoiceNinjaUrl || (!v.invoiceNinjaToken && !p.hasToken)}>Test connection</Button>
      {state.error && <Alert>{state.error}</Alert>}
      {state.companies && (
        <Field label="Company to invoice under" hint="The API token must belong to the selected company.">
          {state.companies.length === 1 ? <Alert tone="green">Connected to {state.companies[0].name}</Alert> : (
            <Select value={v.invoiceNinjaCompanyId ?? ''} onChange={set(p, 'invoiceNinjaCompanyId')}>
              <option value="">Select a company…</option>
              {state.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
      )}
    </div>
  );
}

export function DocusealForm(p: FormProps & { hasToken?: boolean; hasHmacSecret?: boolean }) {
  const v = p.value;
  const [state, setState] = useState<{ busy?: boolean; error?: string; templates?: { id: number; name: string }[]; edition?: string }>({});
  const test = async () => {
    setState({ busy: true });
    try {
      const r = await api('/setup/test/docuseal', { body: { url: v.docusealUrl, token: v.docusealToken || undefined } });
      p.onChange({ ...v, docusealEdition: r.edition, _tested: true });
      setState({ templates: r.templates, edition: r.edition });
    } catch (e) { setState({ error: errorText(e) }); p.onChange({ ...v, _tested: false }); }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Docuseal URL"><Input value={v.docusealUrl ?? ''} onChange={(e) => p.onChange({ ...v, docusealUrl: e.target.value, _tested: false })} /></Field>
        <Field label="API token" hint={p.hasToken ? 'Leave blank to keep the saved token' : 'Docuseal → Settings → API'}>
          <Input type="password" autoComplete="off" value={v.docusealToken ?? ''} onChange={(e) => p.onChange({ ...v, docusealToken: e.target.value, _tested: false })} />
        </Field>
      </div>
      <Button type="button" variant="secondary" onClick={test} loading={state.busy} disabled={!v.docusealUrl || (!v.docusealToken && !p.hasToken)}>Test connection</Button>
      {state.error && <Alert>{state.error}</Alert>}
      {state.templates && <Alert tone="green">Connected — {state.templates.length} Docuseal template(s) found.</Alert>}
      {(state.edition ?? v.docusealEdition) === 'free' && (
        <Alert tone="amber">
          <strong>Docuseal free edition detected.</strong> It can only send templates built in Docuseal, so each contract template here must be
          mapped to a Docuseal template (Contracts → template → “Docuseal template”). In Docuseal, name the template’s text fields after merge fields
          (e.g. <code>client_name</code>, <code>event_date_range</code>, <code>total_hire_cost</code>, <code>bond_amount</code>, <code>equipment_list</code>) and they’ll be
          prefilled and locked for each booking. Docuseal Pro removes this restriction: contracts are then sent as this app’s own branded document.
        </Alert>
      )}
      {(state.edition ?? v.docusealEdition) === 'pro' && <Alert tone="green">Docuseal Pro detected — contracts can be sent as this app’s own branded document, or via a mapped Docuseal template.</Alert>}
      {p.existing && (
        <Field label="Webhook signing secret (optional)" hint={<>Docuseal → Settings → Webhooks → your webhook → signing secret (starts with <code>whsec_</code>). When set, Docuseal’s signed webhooks are verified cryptographically and the custom header is not needed.{p.hasHmacSecret ? ' A secret is saved — leave blank to keep it.' : ''}</>}>
          <Input type="password" autoComplete="off" value={v.docusealWebhookHmacSecret ?? ''} onChange={set(p, 'docusealWebhookHmacSecret')} placeholder={p.hasHmacSecret ? '•••••••• (saved)' : 'whsec_…'} />
        </Field>
      )}
    </div>
  );
}

export function LocaleForm(p: FormProps) {
  const v = p.value;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Timezone" hint={v.timezone === 'Australia/Brisbane' ? 'Queensland does not observe daylight saving.' : undefined}>
        <Select value={v.timezone ?? ''} onChange={set(p, 'timezone')}>
          {[...new Set([v.timezone, ...TIMEZONES].filter(Boolean))].map((t) => <option key={t}>{t}</option>)}
        </Select>
      </Field>
      <Field label="Currency"><Input value={v.currency ?? ''} onChange={(e) => p.onChange({ ...v, currency: e.target.value.toUpperCase() })} maxLength={3} /></Field>
      <Field label="Date format">
        <Select value={v.dateFormat ?? ''} onChange={set(p, 'dateFormat')}>
          {['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'].map((f) => <option key={f}>{f}</option>)}
        </Select>
      </Field>
      <Field label="Public holiday region (optional)" hint="Reserved for holiday surcharge pricing.">
        <Select value={v.holidayRegion ?? ''} onChange={set(p, 'holidayRegion')}><option value="">None</option>{AU_STATES.map((s) => <option key={s}>{s}</option>)}</Select>
      </Field>
      <Field label="Unsigned-contract reminder (days before event)"><Input type="number" min={1} max={60} value={v.contractReminderDays ?? 3} onChange={set(p, 'contractReminderDays')} /></Field>
    </div>
  );
}

export function TermsForm(p: FormProps) {
  const v = p.value;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <p className="text-sm text-slate-500 sm:col-span-2">Your standard terms, filled into every hire agreement (and available as merge fields). Leave blank to leave the field empty.</p>
      <Field label="Late return fee" hint="e.g. $50 per day"><Input value={v.termsLateReturnFee ?? ''} onChange={set(p, 'termsLateReturnFee')} /></Field>
      <Field label="Extension notice required" hint="e.g. 24 hours"><Input value={v.termsExtensionNotice ?? ''} onChange={set(p, 'termsExtensionNotice')} /></Field>
      <Field label="Late payment interest (% per month)"><Input value={v.termsLatePaymentPct ?? ''} onChange={set(p, 'termsLatePaymentPct')} className="max-w-32" /></Field>
      <Field label="Bond refunded within (business days)"><Input type="number" min={0} value={v.termsBondRefundDays ?? ''} onChange={set(p, 'termsBondRefundDays')} className="max-w-32" /></Field>
      <Field label="Cancel more than … days before the event" hint="Deposit forfeited, rest refunded"><Input type="number" min={0} value={v.termsCancelDepositDays ?? ''} onChange={set(p, 'termsCancelDepositDays')} className="max-w-32" /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Cancel within … days"><Input type="number" min={0} value={v.termsCancelLateDays ?? ''} onChange={set(p, 'termsCancelLateDays')} /></Field>
        <Field label="… % of hire fee payable"><Input type="number" min={0} max={100} value={v.termsCancelLatePct ?? ''} onChange={set(p, 'termsCancelLatePct')} /></Field>
      </div>
      <Field label="Balance due" hint="e.g. Invoiced after the event" className="sm:col-span-2"><Input value={v.termsBalanceDue ?? ''} onChange={set(p, 'termsBalanceDue')} /></Field>
    </div>
  );
}

export const LOCALE_DEFAULTS = { timezone: 'Australia/Brisbane', currency: 'AUD', dateFormat: 'DD/MM/YYYY', holidayRegion: '', contractReminderDays: 3 };
export const TAX_DEFAULTS = { gstRegistered: true, gstRate: 10 };

/** Drop wizard-only keys (prefixed with _) before sending. */
export const clean = (d: Draft) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_')));
