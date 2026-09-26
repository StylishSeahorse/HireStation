import { IntegrationError } from './http.js';

// Australian Business Register "ABN Lookup" JSON service. Requires a GUID the
// business registers for at abr.business.gov.au — entered in the wizard, never stored in code.
export interface AbnDetails {
  abn: string;
  entityName: string;
  businessNames: string[];
  state: string;
  postcode: string;
  gstRegisteredFrom: string | null;
  entityType: string;
}

export async function lookupAbn(abn: string, guid: string): Promise<AbnDetails> {
  const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${encodeURIComponent(abn)}&guid=${encodeURIComponent(guid)}&callback=cb`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch((e) => {
    throw new IntegrationError('ABN Lookup', (e as Error).message);
  });
  const text = await res.text();
  const json = JSON.parse(text.replace(/^\s*cb\(/, '').replace(/\)\s*;?\s*$/, ''));
  if (json.Message) throw new IntegrationError('ABN Lookup', json.Message);
  return {
    abn: json.Abn,
    entityName: json.EntityName,
    businessNames: json.BusinessName ?? [],
    state: json.AddressState,
    postcode: json.AddressPostcode,
    gstRegisteredFrom: json.Gst || null,
    entityType: json.EntityTypeName,
  };
}
