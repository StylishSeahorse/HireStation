import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui';

export default function Login() {
  const qc = useQueryClient();
  const branding = useQuery({ queryKey: ['branding'], queryFn: () => api('/branding') });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow"
        onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError('');
          try { await api('/auth/login', { body: { email, password } }); await qc.invalidateQueries(); } catch (x) { setError(errorText(x)); } finally { setBusy(false); }
        }}
      >
        <div className="text-center">
          {branding.data?.logoUrl && <img src={branding.data.logoUrl} alt="" className="mx-auto mb-2 h-14 object-contain" />}
          <h1 className="text-lg font-semibold">{branding.data?.name ?? 'Sign in'}</h1>
        </div>
        <Field label="Email"><Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
      </form>
    </div>
  );
}
