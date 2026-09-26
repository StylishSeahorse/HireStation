import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Login from './Login';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Login', () => {
  it('shows the throttling message returned by the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/branding')
      ? json(200, { name: 'Test Co', logoUrl: null })
      : json(429, { error: 'Too many failed sign-in attempts. Try again in 15 minute(s).' })));
    render(<QueryClientProvider client={new QueryClient()}><Login /></QueryClientProvider>);
    expect(await screen.findByText('Test Co')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/Too many failed sign-in attempts/)).toBeTruthy();
  });
});
