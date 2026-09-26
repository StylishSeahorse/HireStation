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

### With a bundled Docuseal

`docker-compose.docuseal.yml` adds Docuseal (plus its own Postgres) to the same stack.
Invoice Ninja stays external (your existing instance).

```sh
# in .env (see the "Bundled Docuseal" block in .env.example)
COMPOSE_FILE=docker-compose.yml:docker-compose.docuseal.yml
DOCUSEAL_HOST=sign.example.com
DOCUSEAL_DB_PASSWORD=<random>
# DOCUSEAL_SMTP_* so Docuseal can email signing links (or set it in Docuseal's UI)

docker compose up -d --build
```

Then, once:

1. Point `sign.example.com` at `127.0.0.1:DOCUSEAL_PORT` (default 3001) in your reverse
   proxy (examples in `deploy/`). Open it and create the Docuseal admin account.
2. Docuseal → Settings → **API**: copy the token. In HireStation (wizard step 7 or
   Settings → Docuseal) use URL **`http://docuseal:3000`** (internal network, no proxy
   round trip) and that token, then **Test connection**. This also detects the Docuseal edition.
3. Docuseal → Settings → **Webhooks**: add the **internal URL** shown under Settings →
   Docuseal in HireStation (`http://app:3000/api/webhooks/docuseal/…`). The default events
   are the right ones. Copy the webhook's **signing secret** (`whsec_…`) into HireStation's
   "Webhook signing secret" field and save.

Backups then also include Docuseal's database and its data volume. The data volume
includes `docuseal.env`, the key that decrypts Docuseal's data, so keep backups safe.

Restore Docuseal: `docker compose exec -T docuseal-db pg_restore -U docuseal -d docuseal --clean < backups/docuseal-db-….dump`,
and untar `docuseal-data-….tar.gz` into the `docuseal-data` volume.

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
  the local mirror (Sent / Partial with amount paid / Paid), and marks the booking
  **Paid** once every invoice is paid.
- ⚠️ **Webhook URL must be public:** Invoice Ninja refuses to register webhook URLs whose
  hostname resolves to a private or reserved IP (SSRF protection). `PUBLIC_URL` must be
  HireStation's public address (e.g. `https://hire.example.com`) and must resolve to a public IP
  *from the Invoice Ninja server*. A LAN address, `localhost` or split-horizon DNS pointing at a
  private IP will be refused, and HireStation will explain why. The check only happens at
  registration.

Tested end to end against a real Invoice Ninja 5.13.43:
- the client was created with its ABN in `vat_number` and a contact
- the invoice was built from the return checklist: day-of additions, a discount split
  between taxable and GST-free lines, loss/damage and a late fee. GST matched to the cent,
  and the bond was left off
- re-generating updated the draft in place
- mark sent → *Sent* via webhook
- partial payment → *Partial* with the amount paid
- adjusting after issue created a credit note
- paying the balance with the credit applied → *Paid*
- the webhook event IDs (2 invoice created, 4 payment created, 8 invoice updated) match Invoice Ninja's source

### Docuseal

How contracts are sent depends on the **Docuseal edition**, which "Test connection" detects:

- **Pro:** the merged, branded contract HTML (logo, colours, footer) is submitted via
  `POST /api/submissions/html` with the client as signer. `{{client_signature}}` /
  `{{client_signed_date}}` place the fields; if they're missing, a signature block is appended.
- **Free (community) edition:** Docuseal only allows signing templates built in its own UI.
  The HTML/PDF submission APIs are Pro-only. Each HireStation contract template must be
  **mapped** to a Docuseal template (Contracts → template → "Docuseal template"). Unmapped
  templates are refused with a clear message.
  - In Docuseal, upload your agreement (e.g. HireStation's *Print / save as PDF* preview) and
    add text fields **named after merge fields**: `client_name`, `client_abn`, `event_title`,
    `event_date_range`, `venue`, `equipment_list`, `total_hire_cost`, `bond_amount`,
    `business_name`, `business_abn`, … plus a signature field. Name them in Docuseal's
    builder. Its PDF import drops form-field names that contain underscores.
  - HireStation prefills those fields for each booking and **locks them read-only**, so the
    client can't change prices or terms. `equipment_list` is a plain-text version of the equipment table.
  - Mapping also works on Pro if you prefer Docuseal's layout.

In both cases Docuseal emails the signing link. Webhooks:
`form.viewed` → Contract viewed, `form.completed` → Contract signed (the signed PDF is
downloaded through the configured Docuseal URL and stored locally), `form.declined` → Declined.
They're verified by Docuseal's **HMAC signature** (`X-Docuseal-Signature`) when the webhook's
signing secret is saved in Settings. The shared `X-Webhook-Secret` header also works.

The hourly reminder scan notifies staff about contracts still unsigned within N days of
the event, and asks Docuseal to re-send the signing email.

Tested end to end against a real Docuseal 3.2.6 (free edition) running from
`docker-compose.docuseal.yml`: send → client views → signs → HMAC-verified webhooks →
booking "Contract signed" → signed PDF stored.

#### One template, many bookings

You do **not** create a Docuseal template per booking. Build it once and reuse it:

1. **Once:** upload your hire agreement to Docuseal, add fields named after the merge
   fields plus a signature box, and map it to your contract template in HireStation.
2. **Every booking:** press *Generate & send*. HireStation sends that booking's values;
   Docuseal fills them into a fresh copy of the template (a *submission*) and emails the
   client. The template itself never changes.

Create another template only for a genuinely different *kind* of agreement, e.g. one each
for dry hire, full production with staff, and DJ booth bookings.

**Line items:** the equipment goes into one multi-line field, `equipment_list`, one line per
item (e.g. `2 × Line array speaker (2 days) — $720.00`). The field is a fixed-size box on
your template, so:

- size it for your longest typical booking
- very long lists (say 30+ items) may overflow or shrink the text. If large productions are
  common, keep a second template with a bigger equipment area, or one with the list on its
  own page

If that becomes a real limitation, there are two ways out:
- **Docuseal Pro:** HireStation sends its own contract, whose equipment table grows with the booking.
- **Code change:** HireStation could generate a separate equipment-schedule PDF per booking,
  which the signed agreement refers to (not built yet).

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
- **Webhooks:** each request needs an unguessable URL key *and* proof of origin. Docuseal's
  requests are verified with its HMAC `X-Docuseal-Signature` (5-minute replay window) once its
  signing secret is saved. Invoice Ninja doesn't sign, so it must send the `X-Webhook-Secret` header (shown in Settings). "Register
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

## Testing locally

**1. Automated tests** (Node 22 and a Postgres you can throw away)

```sh
npm install
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/hirestation_test npm test
```

⚠️ `TEST_DATABASE_URL` must point at a **test-only** database: the end-to-end suite drops
and recreates its `public` schema. Without it, only the unit tests run.

**2. Full stack with the bundled Docuseal**

```sh
cp .env.example .env
```

In `.env`:
- set `SESSION_SECRET` (32+ chars), `POSTGRES_PASSWORD` and `PUBLIC_URL`
- uncomment the Docuseal block: `COMPOSE_FILE`, `DOCUSEAL_HOST`, `DOCUSEAL_DB_PASSWORD`,
  and the SMTP settings if you want signing emails
- for plain-http testing on your own machine, also set `DOCUSEAL_FORCE_SSL=false`

```sh
docker compose up -d --build
docker compose ps        # all services running; app, db and docuseal healthy
```

**3. One-time setup** (details under *Deploy → With a bundled Docuseal*)

- **Docuseal:** open `http://localhost:3001`, create the admin account, copy the API token
  from Settings → API.
- **HireStation:** open `http://localhost:3000` and complete the wizard.
  - Docuseal URL `http://docuseal:3000` and that token.
  - Your existing Invoice Ninja URL and token, then pick the company.
- **Webhooks:**
  - Docuseal → Settings → Webhooks: add the internal URL HireStation shows, then paste
    Docuseal's signing secret (`whsec_…`) back into HireStation.
  - HireStation → Settings → Invoice Ninja → *Register webhooks*. `PUBLIC_URL` must be a public
    address for this (see *Integrations → Invoice Ninja*). When testing purely on a LAN, this
    step will be refused. Invoices still generate; only automatic status updates need the webhook.

**4. Flows worth trying by hand**

- **Contract:**
  - On Docuseal's free edition, first build and map a Docuseal template (see
    *One template, many bookings*).
  - Send the contract, open the signing link, sign.
  - The booking should move to "Contract signed" and the signed PDF should appear in HireStation.
- **Invoice** (tested against a real Invoice Ninja 5.13; still worth checking with your own instance and settings):
  - Complete a booking's departure checklist, then its return checklist.
  - A draft invoice should appear in Invoice Ninja, built from what actually came back.
  - Record a payment in Invoice Ninja; the booking should move to "Paid".
- **Security:**
  - 5 wrong passwords lock the account for 15 minutes.
  - Settings → Audit log and Settings → Webhook log show activity.

If something breaks, `docker compose logs app worker` (and `docuseal` for signing issues)
is the first place to look.

## Not yet built / notes

- Public-holiday surcharge pricing: the region is captured in settings, but no
  surcharge rules exist yet.
- On Docuseal's free edition, the equipment list is a fixed-size text field (see
  *One template, many bookings*). A per-booking equipment-schedule PDF isn't built yet.
- Invoice Ninja tokens are company-scoped. The company picker records which
  company you intend, so use a token issued for that company.
