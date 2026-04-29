/**
 * Vendor onboarding — pure input parser + normalization helpers.
 *
 * Extracted from `vendor-onboarding.ts` so consumers (e.g. the
 * vendor-master coordinator at P0-4) can import these helpers without
 * dragging in the production server-side QBO/Notion/Drive imports
 * (which transitively pull `server-only` and break vitest module
 * resolution).
 *
 * This module is pure — no I/O, no env reads. Same input → same output.
 */

export type VendorOnboardingInput = {
  name: string;
  companyName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  terms?: string;
  termsId?: string;
  taxClass?: string;
  taxIdentifier?: string;
  accountNumber?: string;
  w9DriveUrl?: string;
  coiDriveUrl?: string;
  originator?: string;
  notes?: string;
};

export type OpenVendorOnboardingResult =
  | {
      ok: true;
      approvalId: string;
      proposalTs: string | null;
      payloadRef: string;
      dedupeKey: string;
    }
  | { ok: false; error: string; status?: number; existing?: unknown };

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanEmail(value: unknown): string | undefined {
  const email = clean(value)?.toLowerCase();
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj) as Array<[keyof T, T[keyof T]]>) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}

export function normalizeVendorKey(input: Pick<VendorOnboardingInput, "name" | "email">): string {
  const base = (input.email || input.name || "vendor")
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "vendor";
}

export function parseVendorOnboardingInput(raw: unknown): {
  ok: true;
  input: VendorOnboardingInput;
} | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "JSON object body required" };
  }
  const body = raw as Record<string, unknown>;
  const name = clean(body.name);
  if (!name) return { ok: false, error: "name is required" };

  const email = cleanEmail(body.email);
  if (body.email && !email) return { ok: false, error: "email is invalid" };

  const addressRaw =
    body.address && typeof body.address === "object"
      ? (body.address as Record<string, unknown>)
      : {};
  const address = compact({
    line1: clean(addressRaw.line1) || clean(body.addressLine1) || clean(body.address),
    line2: clean(addressRaw.line2) || clean(body.addressLine2),
    city: clean(addressRaw.city) || clean(body.city),
    state: clean(addressRaw.state) || clean(body.state)?.toUpperCase(),
    postalCode: clean(addressRaw.postalCode) || clean(body.postalCode) || clean(body.zip),
    country: clean(addressRaw.country) || clean(body.country) || "US",
  });

  const input: VendorOnboardingInput = compact({
    name,
    companyName: clean(body.companyName) || clean(body.company_name) || name,
    contactName: clean(body.contactName) || clean(body.contact_name),
    email,
    phone: clean(body.phone),
    website: clean(body.website),
    address: Object.keys(address).length > 0 ? address : undefined,
    terms: clean(body.terms),
    termsId: clean(body.termsId) || clean(body.terms_id),
    taxClass: clean(body.taxClass) || clean(body.tax_class),
    taxIdentifier: clean(body.taxIdentifier) || clean(body.tax_id),
    accountNumber: clean(body.accountNumber) || clean(body.acct_num),
    w9DriveUrl: clean(body.w9DriveUrl) || clean(body.w9_drive_url),
    coiDriveUrl: clean(body.coiDriveUrl) || clean(body.coi_drive_url),
    originator: clean(body.originator),
    notes: clean(body.notes),
  }) as VendorOnboardingInput;

  return { ok: true, input };
}

/** Exposed for tests. */
export const __INTERNAL_PARSE = { clean, cleanEmail, compact };
