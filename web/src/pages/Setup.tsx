import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { useSetupStatus } from '@/lib/hooks';
import { formatAbn } from '@/lib/au';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { BankingForm, BrandingForm, clean, Draft, DocusealForm, IdentityForm, InvoiceNinjaForm, LocaleForm, LOCALE_DEFAULTS, TaxForm, TAX_DEFAULTS } from '@/components/SettingsForms';

const STEPS = ['Admin account', 'Business identity', 'Tax', 'Banking', 'Branding', 'Invoice Ninja', 'Docuseal', 'Locale & defaults', 'Review'];
const STORE = 'hs-setup-draft';

type State = { identity: Draft; tax: Draft; banking: Draft; branding: Draft; invoiceNinja: Draft; docuseal: Draft; locale: Draft; logoPath?: string | null; logoPreview?: string | null; skipIn?: boolean; skipDs?: boolean };

const initial: State = { identity: {}, tax: { ...TAX_DEFAULTS }, banking: {}, branding: {}, invoiceNinja: {}, docuseal: {}, locale: { ...LOCALE_DEFAULTS } };

function loadDraft(): State {
  try { return { ...initial, ...JSON.parse(sessionStorage.getItem(STORE) ?? '{}') }; } catch { return initial; }
}

export default function Setup() {
  const status = useSetupStatus();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<State>(loadDraft);
  const [admin, setAdmin] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    // Persist the draft (minus secrets) so a refresh doesn't lose progress.
    const { invoiceNinja, docuseal, identity, ...rest } = s;
    const strip = (d: Draft, k: string) => { const { [k]: _, ...o } = d; return o; };
    sessionStorage.setItem(STORE, JSON.stringify({ ...rest, identity: strip(identity, 'abrGuid'), invoiceNinja: strip(invoiceNinja, 'invoiceNinjaToken'), docuseal: strip(docuseal, 'docusealToken') }));
  }, [s]);

  useEffect(() => {
    if (status.data?.hasAdmin) api('/setup/whoami').then((r) => { setSignedIn(!!r.user); if (r.user) setStep((x) => Math.max(x, 1)); });
  }, [status.data?.hasAdmin]);

  if (status.data && !status.data.needsSetup) { location.assign('/'); return null; }

  const upd = (k: keyof State) => (v: Draft) => setS((x) => ({ ...x, [k]: v }));

  const next = async () => {
    setError('');
    try {
      if (step === 0) {
        if (admin.password !== admin.confirm) throw new Error('Passwords do not match');
        setBusy(true);
        await api('/setup/admin', { body: { name: admin.name, email: admin.email, password: admin.password } });
        await qc.invalidateQueries({ queryKey: ['setup-status'] });
        setSignedIn(true);
      }
      const section = ({ 1: 'identity', 2: 'tax', 3: 'banking', 7: 'locale' } as Record<number, keyof State>)[step];
      if (section) { setBusy(true); await api(`/setup/validate/${section}`, { body: clean(s[section] as Draft) }); }
      if (step === 5 && !s.skipIn && (!s.invoiceNinja._tested || !s.invoiceNinja.invoiceNinjaCompanyId)) throw new Error('Test the connection and choose a company, or skip this step for now.');
      if (step === 6 && !s.skipDs && !s.docuseal._tested) throw new Error('Test the connection, or skip this step for now.');
      setStep(step + 1);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true); setError('');
    try {
      await api('/setup/finish', {
        body: {
          identity: clean(s.identity), tax: { ...s.tax, gstRate: Number(s.tax.gstRate ?? 0) }, banking: s.banking, branding: {
            primaryColour: s.branding.primaryColour || null, accentColour: s.branding.accentColour || null, documentFooter: s.branding.documentFooter || null,
          },
          invoiceNinja: s.skipIn ? null : clean(s.invoiceNinja), docuseal: s.skipDs ? null : clean(s.docuseal), locale: s.locale, logoPath: s.logoPath ?? null,
        },
      });
      sessionStorage.removeItem(STORE);
      location.assign('/');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const needsLogin = status.data?.hasAdmin && signedIn === false;

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto max-w-3xl px-4">
        <h1 className="mb-1 text-2xl font-semibold">Welcome — let’s set up your business</h1>
        <p className="mb-6 text-sm text-slate-500">Everything here can be changed later in Settings.</p>
        <ol className="mb-6 flex flex-wrap gap-1 text-xs">
          {STEPS.map((t, i) => (
            <li key={t} className={`rounded-full px-2.5 py-1 ${i === step ? 'bg-brand text-white' : i < step ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-500'}`}>{i + 1}. {t}</li>
          ))}
        </ol>
        {needsLogin ? <SetupLogin onDone={() => { setSignedIn(true); setStep(1); }} /> : (
          <Card title={STEPS[step]}>
            <div className="space-y-4">
              {step === 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your name"><Input value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} /></Field>
                  <Field label="Email"><Input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></Field>
                  <Field label="Password" hint="At least 10 characters"><Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} /></Field>
                  <Field label="Confirm password"><Input type="password" value={admin.confirm} onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} /></Field>
                </div>
              )}
              {step === 1 && <IdentityForm value={s.identity} onChange={upd('identity')} />}
              {step === 2 && <TaxForm value={s.tax} onChange={upd('tax')} />}
              {step === 3 && <BankingForm value={s.banking} onChange={upd('banking')} />}
              {step === 4 && (
                <BrandingForm value={s.branding} onChange={upd('branding')} logoUrl={s.logoPreview}
                  onLogo={async (f) => {
                    const form = new FormData(); form.append('file', f);
                    const r = await api('/setup/logo', { form });
                    const preview = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(f); });
                    setS((x) => ({ ...x, logoPath: r.logoPath, logoPreview: preview }));
                  }}
                  onRemoveLogo={() => setS((x) => ({ ...x, logoPath: null, logoPreview: null }))} />
              )}
              {step === 5 && (s.skipIn ? <SkipNote onUndo={() => setS({ ...s, skipIn: false })} what="Invoice Ninja" /> : <InvoiceNinjaForm value={s.invoiceNinja} onChange={upd('invoiceNinja')} />)}
              {step === 6 && (s.skipDs ? <SkipNote onUndo={() => setS({ ...s, skipDs: false })} what="Docuseal" /> : <DocusealForm value={s.docuseal} onChange={upd('docuseal')} />)}
              {step === 7 && <LocaleForm value={s.locale} onChange={upd('locale')} />}
              {step === 8 && <Review s={s} />}
              {error && <Alert>{error}</Alert>}
              <div className="flex justify-between border-t pt-4">
                <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={step <= 1}>Back</Button>
                <div className="flex gap-2">
                  {step === 5 && !s.skipIn && <Button variant="ghost" onClick={() => { setS({ ...s, skipIn: true }); setStep(6); }}>Skip for now</Button>}
                  {step === 6 && !s.skipDs && <Button variant="ghost" onClick={() => { setS({ ...s, skipDs: true }); setStep(7); }}>Skip for now</Button>}
                  {step < 8 ? <Button onClick={next} loading={busy}>Continue</Button> : <Button onClick={finish} loading={busy}>Finish setup</Button>}
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function SkipNote({ what, onUndo }: { what: string; onUndo: () => void }) {
  return <Alert tone="amber">{what} will be skipped. Features that depend on it stay disabled until you connect it in Settings. <button className="underline" onClick={onUndo}>Set it up now</button></Alert>;
}

function SetupLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <Card title="Sign in to continue setup">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await api('/auth/login', { body: { email, password } }); onDone(); } catch (x) { setError(errorText(x)); } }}>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit">Sign in</Button>
      </form>
    </Card>
  );
}

function Review({ s }: { s: State }) {
  const i = s.identity;
  const rows: [string, React.ReactNode][] = [
    ['Business', `${i.legalName ?? ''}${i.tradingName ? ` (trading as ${i.tradingName})` : ''}`],
    ['ABN / ACN', `${formatAbn(i.abn)}${i.acn ? ` / ${i.acn}` : ''}`],
    ['Address', [i.addressLine1, i.addressLine2, `${i.suburb ?? ''} ${i.state ?? ''} ${i.postcode ?? ''}`].filter(Boolean).join(', ')],
    ['Contact', `${i.contactEmail ?? ''} · ${i.contactPhone ?? ''}`],
    ['GST', s.tax.gstRegistered ? `Registered, ${s.tax.gstRate}%` : 'Not registered'],
    ['Bank', `${s.banking.bankBsb ?? ''} ${s.banking.bankAccountNumber ?? ''} (${s.banking.bankAccountName ?? ''})`],
    ['Branding', <span className="flex items-center gap-2">{s.logoPreview && <img src={s.logoPreview} className="h-8" />}{[s.branding.primaryColour, s.branding.accentColour].filter(Boolean).map((c) => <span key={c} className="inline-block h-5 w-5 rounded" style={{ background: c }} />)}</span>],
    ['Invoice Ninja', s.skipIn ? 'Skipped' : s.invoiceNinja.invoiceNinjaUrl],
    ['Docuseal', s.skipDs ? 'Skipped' : s.docuseal.docusealUrl],
    ['Locale', `${s.locale.timezone}, ${s.locale.currency}, ${s.locale.dateFormat}`],
  ];
  return (
    <dl className="divide-y text-sm">
      {rows.map(([k, v]) => <div key={k} className="grid grid-cols-3 gap-2 py-2"><dt className="text-slate-500">{k}</dt><dd className="col-span-2">{v}</dd></div>)}
    </dl>
  );
}
