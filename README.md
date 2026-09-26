# HireStation

Self-hosted equipment hire and event booking management for a single Australian
event production / hire business. The app owns inventory, availability, bookings,
clients, staff, departure/return checklists and contract authoring. It hands
invoicing to **Invoice Ninja** and contract signing to **Docuseal**.

There is **no business data in this repository**: no name, ABN, bank details,
logo, colours or third-party credentials. A fresh install boots against an empty
database and forces the first-run setup wizard before anything else can be used.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript, Vite, Tailwind v4, TanStack Query, FullCalendar (luxon tz), TipTap |
| Backend | Node 22 + TypeScript, Fastify 5, Prisma 6, PostgreSQL 16 |
| Jobs | BullMQ + Redis (runs inline when `REDIS_URL` is empty, for local dev) |
| Files | Local volume (`STORAGE_PATH`): logo, equipment photos, signed contract PDFs |
| Auth | Signed httpOnly session cookie; roles Admin / Staff / Read-only |

```
server/   Fastify API, Prisma schema + migrations, BullMQ worker
web/      React SPA (served by the API in production)
scripts/  backup.sh used by the compose backup service
```

## Configuration

`.env` holds **infrastructure only** (see `.env.example`):
`DATABASE_URL`, `SESSION_SECRET` (≥32 chars), `REDIS_URL`, `STORAGE_PATH`, `PORT`,
`PUBLIC_URL` (used to build the webhook URLs), plus the compose-only Postgres
password, bind address and backup settings.

Everything else — business identity, ABN/ACN, GST registration and rate, bank
details, branding, Invoice Ninja and Docuseal URLs/tokens, timezone, currency,
date format — goes into the singleton `BusinessProfile` row through the wizard,
and can be edited later under **Settings** (the same forms). The API never returns stored tokens
to the browser.

## Deploy (Docker Compose)

```sh
cp .env.example .env    # set SESSION_SECRET, POSTGRES_PASSWORD, PUBLIC_URL (and APP_PORT if 3000 is taken)
docker compose up -d --build
```

Then open `http://<host>:APP_PORT` (or your proxied subdomain) and complete the
setup wizard. Upgrades: `git pull && docker compose up -d --build`. Database
migrations run automatically when the app container starts.

The image is a two-stage build (`node:22-bookworm` → `node:22-bookworm-slim`,
runs as the non-root `node` user, ~185 MB compressed). It needs no `apt-get`:
the OpenSSL libraries Prisma requires are copied from the build stage. `app`
and `worker` share one image (`hirestation:latest`), which is built by the `app`
service.

**Restore from backup**

```sh
docker compose exec -T db pg_restore -U hirestation -d hirestation --clean < backups/db-YYYYMMDD-HHMMSS.dump
docker compose run --rm -v "$PWD/backups:/backups" app sh -c 'tar -xzf /backups/storage-YYYYMMDD-HHMMSS.tar.gz -C /data'
```

Services: `app` (API + SPA, runs `prisma migrate deploy` on start), `worker`
(BullMQ: contract sends, invoice generation, webhook processing, hourly reminder
scan), `db`, `redis`, and `backup` (nightly `pg_dump` + storage tarball into
`BACKUP_PATH`, pruned after `BACKUP_KEEP_DAYS`). Put `app` behind your existing
reverse proxy on its own subdomain. It is published on `APP_BIND:APP_PORT`
(default `127.0.0.1:3000`). A backup runs when the stack starts and then every 24 hours.

The business profile now lives in the database, not a config file, so include
`BACKUP_PATH` in your normal off-site backups.

## First-run wizard

1. Admin account (only possible while no user exists)
2. Business identity: name, structure, ABN (checksum validated), ACN (checksum
   validated), address, contact, signatory. Optional **ABN Lookup** autofill
   (requires a free ABR GUID; the wizard works without it)
3. Tax: GST-registered toggle and rate (10% is pre-filled but stored; the
   code always reads the setting)
4. Banking: BSB (XXX-XXX), account number, account name
5. Branding: logo, primary/accent colours, document footer
6. Invoice Ninja: URL + token → **Test connection** → choose company
7. Docuseal: URL + token → **Test connection**
8. Locale: timezone (Australia/Brisbane suggested), currency, date format,
   holiday region, unsigned-contract reminder lead time
9. Review → **Finish setup**

Steps 6–7 can be skipped (e.g. Docuseal isn't deployed yet). The dependent
features stay disabled until you connect them in Settings.

## Integrations

### Invoice Ninja (v5)
- **Trigger:** completing the **return checklist** queues `invoice.generate`.
  Lines come from what actually went out (departure qty × rate × days), plus
  labour, discount, damage/loss charges and the late fee. They never come from the original
  booking list.
- **Client sync:** matches an existing IN client by email or ABN (`vat_number`),
  otherwise creates one, then stores `invoiceNinjaClientId` on the local client.
- **Draft vs issued:** "Regenerate draft" updates the IN invoice in place while
  it's still a draft. "Adjust issued invoice" raises a follow-up invoice or a
  credit note for the difference.
- **GST:** each taxable line carries `GST` at the configured rate. The supplier
  ABN is in the public notes. Turn on IN's tax-invoice labelling so documents read "Tax Invoice".
- **Bonds** never appear on the invoice unless forfeited. A forfeited amount is
  treated as GST-inclusive consideration for damage/loss.
- **Status sync:** Settings → Invoice Ninja → *Register webhooks* subscribes
  invoice create/update and payment create events to a secret URL. The worker
  re-fetches the invoice from the API (it does not trust the payload), updates
  the local mirror, and marks the booking **Paid** once every invoice is paid.

### Docuseal
- By default, the merged, branded contract HTML (logo, colours, footer) is
  submitted via `POST /api/submissions/html` with the client as signer. Docuseal
  emails the signing link. `{{client_signature}}` / `{{client_signed_date}}`
  place the fields; if they're missing, a signature block is appended.
- Optionally, map a contract template to an existing Docuseal template. The
  booking's merge values then prefill fields with matching names.
- Webhook (add the URL from Settings → Docuseal in Docuseal's webhook settings):
  `form.viewed` → Contract viewed, `form.completed` → Contract signed (the
  signed PDF is downloaded and stored locally), `form.declined` → Declined.
- The hourly reminder scan notifies staff about contracts still unsigned within
  N days of the event and asks Docuseal to re-send the signing email.

## Feature map

- **Equipment:** categories/sub-categories, tags, photos, daily rate,
  replacement value, per-item GST treatment, stock quantity or serialised units
  with condition notes, archive-on-delete once used, date-range availability.
- **Bookings:** 5-step creation (client → dates/venue → equipment with live
  availability → staff → pricing summary), conflict warnings (booking page and
  ⚠ on calendar), duplication with time shift, colour-coded calendar in the
  business timezone.
- **Checklists:** departure (adjust quantities, add items used on the day, pick
  serial units) and return (qty returned, condition, damage notes/charges, a
  "use replacement value" shortcut, late flag + fee). Admins can amend a completed return.
- **Bonds:** held / refunded / partially / fully forfeited, and refund
  instructions that quote the business bank details.
- **Contracts:** TipTap editor, merge-field palette, drag-and-drop clause
  library, versioned templates (saving creates a new version, and issued contracts
  keep theirs), live branded preview with sample data or a real booking,
  print/save as PDF.
- **Reports:** revenue by month (ex GST / GST / paid), equipment utilisation,
  outstanding bonds. The dashboard shows the week ahead, overdue returns, unsigned contracts
  and outstanding invoices.

## Security

- **Sign-in throttling:** after 5 failed attempts an account is locked for 15 minutes, and an IP
  is locked after 20 failures. Attempts return `429` with `Retry-After`. Counters live in memory
  (single instance) and reset on restart.
- **Session revocation:** sessions carry a per-user version. Changing your password, an admin
  resetting a password, changing someone's role or disabling them, and **Settings → My account →
  Sign out everywhere else** all invalidate existing sessions immediately.
- **Audit log** (Settings → Audit log, admins only): every sign-in, failed or throttled sign-in,
  setup step and state-changing API call, with user, IP, result and request body. Secrets
  (tokens, passwords, GUIDs, keys) are redacted before storage, and large bodies are reduced to their field names.
- **Webhooks:** Invoice Ninja and Docuseal don't sign their webhooks, so each request needs both
  an unguessable URL key *and* an `X-Webhook-Secret` header (shown in Settings). "Register
  webhooks" configures Invoice Ninja's header automatically. In Docuseal, add it as a custom
  header. Events are stored and processed by retryable jobs. **Settings → Webhook log** shows
  failures and lets you replay any event.
- **CSRF / headers:** cookies are `HttpOnly`, `SameSite=Lax` and `Secure` in production. State-changing
  requests with a foreign `Origin` are refused. Responses carry `nosniff`, `X-Frame-Options`,
  `Referrer-Policy`, HSTS (production) and a strict Content-Security-Policy on HTML.
- **Proxy trust:** `X-Forwarded-*` is only honoured from loopback/private networks unless
  `TRUST_PROXY` says otherwise (see `deploy/README.md`), so clients can't spoof their IP past the
  throttle.

## Reverse proxy

`deploy/Caddyfile` and `deploy/nginx.conf` are ready-to-edit examples. `deploy/README.md` has
the checklist (`PUBLIC_URL`, host header, `TRUST_PROXY`, upload size).

## CI

`.github/workflows/ci.yml` runs on every push and PR. It:
- type-checks and tests the server against a Postgres service, including the full e2e flow
- checks that the migrations match the schema
- type-checks, tests and builds the web app
- builds the Docker image and boots the compose stack from an empty database to confirm
  that setup is forced and the worker starts.

## Development

```sh
npm install
cp .env.example .env && cp .env server/.env   # point at a local Postgres
npm run migrate -w server
npm run dev -w server      # API on :3000
npm run dev -w web         # Vite on :5173, proxies /api
npm run worker -w server   # optional, when REDIS_URL is set
```

Tests: `npm test` runs both suites. `npm test -w server` covers pricing/GST, ABN/ACN/BSB, the rate limiter and audit redaction. `npm test -w web` covers timezone handling, UI primitives and the login screen.
The end-to-end suite also runs when `TEST_DATABASE_URL` points to a
**dedicated, disposable** database. It drops and recreates that database's
`public` schema, then drives setup → booking → Docuseal → return → Invoice Ninja → paid
against mock integration servers.

## Not yet built / notes

- Public-holiday surcharge pricing: the region is captured in settings, but no
  surcharge rules exist yet.
- Invoice Ninja tokens are company-scoped. The company picker records which
  company you intend, so use a token issued for that company.
