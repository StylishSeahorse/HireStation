import type { Client, Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { isValidAbn, normaliseDigits } from '../lib/au.js';
import { invoiceNinjaClient } from '../lib/profile.js';
import type { InClient } from './invoiceNinja.js';

// Invoice Ninja is the source of truth for client details. Linked clients take their name, ABN,
// contact, email, phone and address from Invoice Ninja; HireStation keeps its own notes and bookings.
// Clients are never deleted here, even if removed in Invoice Ninja (they may have booking history).

type ClientFields = Pick<Prisma.ClientUncheckedCreateInput, 'type' | 'name' | 'contactName' | 'email' | 'phone' | 'abn' | 'address'>;

const clean = (v?: string | null) => (v ?? '').trim();

/** Map an Invoice Ninja client to HireStation's client fields. */
export function mapInClient(c: InClient): ClientFields {
  const contacts = c.contacts ?? [];
  const primary = contacts.find((x) => x.is_primary) ?? contacts[0];
  const contactName = [clean(primary?.first_name), clean(primary?.last_name)].filter(Boolean).join(' ');
  const email = clean(primary?.email) || null;
  const name = clean(c.name) || clean(c.display_name) || contactName || email || 'Unnamed client';
  // Only keep a checksum-valid ABN; Invoice Ninja's vat_number/id_number may hold other identifiers.
  const abnCandidate = [c.vat_number, c.id_number].map((v) => normaliseDigits(v ?? '')).find((v) => v.length === 11 && isValidAbn(v));
  const abn = abnCandidate ?? null;
  // A business if it has an ABN, or a client name distinct from the contact person's name.
  const business = !!abn || (!!contactName && contactName.toLowerCase() !== name.toLowerCase());
  const [line1, line2] = [clean(c.address1), clean(c.address2)];
  const locality = [clean(c.city), clean(c.state), clean(c.postal_code)].filter(Boolean).join(' ');
  const address = [line1, line2, locality].filter(Boolean).join(', ') || null;
  return {
    type: business ? 'BUSINESS' : 'INDIVIDUAL',
    name,
    contactName: business ? contactName || null : null,
    email,
    phone: clean(primary?.phone) || clean(c.phone) || null,
    abn,
    address,
  };
}

/**
 * Find the HireStation client for an Invoice Ninja client: already linked, else an unlinked client
 * with the same email, else the same ABN. Name alone is used only when Invoice Ninja has neither.
 */
async function findLocal(inId: string, f: ClientFields): Promise<Client | null> {
  const linked = await prisma.client.findUnique({ where: { invoiceNinjaClientId: inId } });
  if (linked) return linked;
  const unlinked = { invoiceNinjaClientId: null };
  if (f.email) {
    const byEmail = await prisma.client.findFirst({ where: { ...unlinked, email: { equals: f.email, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } });
    if (byEmail) return byEmail;
  }
  if (f.abn) {
    const byAbn = await prisma.client.findFirst({ where: { ...unlinked, abn: f.abn }, orderBy: { createdAt: 'asc' } });
    if (byAbn) return byAbn;
  }
  if (!f.email && !f.abn) {
    return prisma.client.findFirst({ where: { ...unlinked, email: null, abn: null, name: { equals: f.name, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } });
  }
  return null;
}

export type SyncAction = 'created' | 'updated' | 'linked' | 'unchanged';

const changed = (local: Client, f: ClientFields) =>
  (Object.keys(f) as (keyof ClientFields)[]).filter((k) => (local[k] ?? null) !== (f[k] ?? null));

/** Plan (dryRun) or apply the sync of one Invoice Ninja client. */
export async function syncInClient(c: InClient, dryRun = false): Promise<{ action: SyncAction; clientId?: string; name: string; changes: string[] }> {
  const f = mapInClient(c);
  const local = await findLocal(c.id, f);
  if (!local) {
    if (dryRun) return { action: 'created', name: f.name, changes: [] };
    const created = await prisma.client.create({ data: { ...f, invoiceNinjaClientId: c.id, invoiceNinjaSyncedAt: new Date() } });
    return { action: 'created', clientId: created.id, name: f.name, changes: [] };
  }
  const diff = changed(local, f);
  const linking = local.invoiceNinjaClientId !== c.id;
  const action: SyncAction = linking ? 'linked' : diff.length ? 'updated' : 'unchanged';
  if (!dryRun && action !== 'unchanged') {
    await prisma.client.update({ where: { id: local.id }, data: { ...f, invoiceNinjaClientId: c.id, invoiceNinjaSyncedAt: new Date() } });
  } else if (!dryRun) {
    await prisma.client.update({ where: { id: local.id }, data: { invoiceNinjaSyncedAt: new Date() } });
  }
  return { action, clientId: local.id, name: f.name, changes: diff };
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  linked: number;
  unchanged: number;
  items: { action: SyncAction; name: string; clientId?: string; changes: string[] }[];
}

/** Preview (dryRun) or run a full import of all active Invoice Ninja clients. */
export async function importInClients(dryRun: boolean): Promise<ImportSummary> {
  const { client } = await invoiceNinjaClient();
  const list = await client.listActiveClients();
  const summary: ImportSummary = { total: list.length, created: 0, updated: 0, linked: 0, unchanged: 0, items: [] };
  for (const c of list) {
    const r = await syncInClient(c, dryRun);
    summary[r.action]++;
    summary.items.push(r);
  }
  return summary;
}

/** Webhook path: re-fetch the client from Invoice Ninja (don't trust the payload) and apply it. */
export async function syncInClientById(id: string): Promise<string | void> {
  const { client } = await invoiceNinjaClient();
  const c = await client.getClient(id);
  if (c.is_deleted || c.archived_at) return 'Archived/deleted in Invoice Ninja; left unchanged here';
  const r = await syncInClient(c);
  return r.action === 'unchanged' ? 'No changes' : undefined;
}
