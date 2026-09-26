# Reverse proxy

The compose stack publishes the app on `127.0.0.1:3000` (`APP_BIND` / `APP_PORT` in `.env`).
With the presets, Docuseal is published on `127.0.0.1:3001` (`DOCUSEAL_PORT`) and, for the full
stack, Invoice Ninja on `127.0.0.1:3002` (`IN_PORT`), each on its own subdomain.
Point your existing proxy at them using one of these examples:

- `Caddyfile`: Caddy with automatic HTTPS
- `nginx.conf`: nginx with certbot certificates

Checklist:

1. Set `PUBLIC_URL=https://hire.example.com` in `.env` so webhook URLs shown in Settings are correct.
2. The proxy must pass `Host` (or `X-Forwarded-Host`) unchanged. State-changing requests whose
   `Origin` doesn't match the host are refused.
3. The app only trusts `X-Forwarded-*` from loopback and private networks by default, which covers a
   proxy on the same host or Docker network. If your proxy connects from elsewhere, set
   `TRUST_PROXY` in `.env` to its address or CIDR (e.g. `TRUST_PROXY=203.0.113.10`).
   Never set it to `true` when the app port is reachable directly, or clients could spoof
   their IP and get around the login throttle.
4. Webhooks: Invoice Ninja and Docuseal must be able to reach `PUBLIC_URL/api/webhooks/...`.
   Invoice Ninja additionally **refuses to register** a webhook URL whose hostname resolves to a
   private IP from its server, so `PUBLIC_URL` must resolve to your public IP there. That's the
   normal case for a public subdomain. If you use split-horizon DNS, make sure the Invoice Ninja
   container resolves it publicly. The bundled Docuseal can use the internal URL instead.
