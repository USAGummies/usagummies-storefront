/**
 * Apollo.io API client — typed wrapper around `/v1/mixed_people/search`.
 *
 * Used by Phase D5 (Apollo enrichment with provenance) and the
 * existing outreach-validate.mjs gate. Centralizes the auth + request
 * shape so future Apollo-touching code doesn't re-implement it.
 *
 * Auth env: `APOLLO_API_KEY`.
 *
 * Fail-soft: every error path returns `{ ok: false, ... }` rather than
 * throwing. Callers degrade gracefully.
 */

const APOLLO_SEARCH_URL = "https://api.apollo.io/v1/mixed_people/search";

export interface ApolloPersonOrganization {
  name?: string;
  industry?: string;
  estimated_num_employees?: number;
  website_url?: string;
  /** Apollo's structured location string. */
  primary_phone?: { sanitized_number?: string };
}

export interface ApolloPerson {
  id?: string;
  email?: string | null;
  /** Apollo's email-verification status. "verified" is the high-confidence tier. */
  email_status?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  /** Direct phone, when unlocked. */
  phone_numbers?: Array<{ sanitized_number?: string; type?: string }>;
  /** Mobile (often the highest-leverage contact field). */
  mobile_phone_number?: string | null;
  city?: string;
  state?: string;
  country?: string;
  organization?: ApolloPersonOrganization;
  /** Apollo's LinkedIn URL when available. */
  linkedin_url?: string;
}

export interface ApolloLookupResult {
  ok: boolean;
  /** True when Apollo env wasn't configured (skip silently). */
  skipped?: boolean;
  /** Best-match person record (null when no match). */
  person?: ApolloPerson | null;
  /** Apollo's verified-email check (separate from a person record existing). */
  verified?: boolean;
  /** Apollo's "email is unlocked" check — locked emails CANNOT be used for outbound. */
  unlocked?: boolean;
  /** Source citation per /contracts/governance.md §1 #2. */
  source: { system: "apollo"; retrievedAt: string; queryEmail: string };
  /** Error message when ok=false. */
  error?: string;
}

/** True when APOLLO_API_KEY is set. */
export function isApolloConfigured(): boolean {
  return Boolean(process.env.APOLLO_API_KEY?.trim());
}

/**
 * Look up a person by email. Returns a structured result with the
 * best-match Apollo person record + verified/unlocked flags.
 *
 * Algorithm:
 *   1. POST `/v1/mixed_people/search` with `q_keywords: <email>`
 *   2. Search both `people` and `contacts` arrays in the response
 *   3. Find the person whose `.email` matches our query email (case-insensitive)
 *   4. Compute `verified = email_status === "verified"` and
 *      `unlocked = email && !email.includes("email_not_unlocked")`.
 *
 * Fail-soft: missing env, network error, non-2xx, empty response,
 * non-JSON body all return `{ ok: false, ... }` without throwing.
 */
export async function lookupApolloPersonByEmail(
  email: string,
): Promise<ApolloLookupResult> {
  const retrievedAt = new Date().toISOString();
  const queryEmail = email.trim().toLowerCase();
  if (!queryEmail) {
    return {
      ok: false,
      error: "empty email",
      source: { system: "apollo", retrievedAt, queryEmail },
    };
  }
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      error: "APOLLO_API_KEY not configured",
      source: { system: "apollo", retrievedAt, queryEmail },
    };
  }

  let res: Response;
  try {
    res = await fetch(APOLLO_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        q_keywords: queryEmail,
        page: 1,
        per_page: 5,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Apollo fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      source: { system: "apollo", retrievedAt, queryEmail },
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `Apollo HTTP ${res.status}`,
      source: { system: "apollo", retrievedAt, queryEmail },
    };
  }
  let data: { people?: unknown[]; contacts?: unknown[] };
  try {
    data = (await res.json()) as { people?: unknown[]; contacts?: unknown[] };
  } catch (err) {
    return {
      ok: false,
      error: `Apollo non-JSON: ${err instanceof Error ? err.message : String(err)}`,
      source: { system: "apollo", retrievedAt, queryEmail },
    };
  }

  const people = [
    ...((data.people as ApolloPerson[]) ?? []),
    ...((data.contacts as ApolloPerson[]) ?? []),
  ];
  const match = people.find(
    (p) => String(p.email ?? "").toLowerCase() === queryEmail,
  );
  if (!match) {
    return {
      ok: true,
      person: null,
      verified: false,
      unlocked: false,
      source: { system: "apollo", retrievedAt, queryEmail },
    };
  }

  const verified = match.email_status === "verified";
  const unlocked = Boolean(
    match.email && !match.email.toLowerCase().includes("email_not_unlocked"),
  );

  return {
    ok: true,
    person: match,
    verified,
    unlocked,
    source: { system: "apollo", retrievedAt, queryEmail },
  };
}

/** Best mobile/phone string from an Apollo person record. */
export function pickPhoneFromApolloPerson(p: ApolloPerson): string | null {
  if (p.mobile_phone_number?.trim()) return p.mobile_phone_number.trim();
  for (const entry of p.phone_numbers ?? []) {
    if (entry.sanitized_number?.trim()) return entry.sanitized_number.trim();
  }
  if (p.organization?.primary_phone?.sanitized_number?.trim()) {
    return p.organization.primary_phone.sanitized_number.trim();
  }
  return null;
}
