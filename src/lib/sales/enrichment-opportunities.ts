/**
 * Phase D5 v0.3 — enrichment-opportunities counter for the morning brief.
 *
 * v0.1 shipped the pure helpers (apollo-client + apollo-enrichment).
 * v0.2 shipped the per-contact + bulk-sweep routes. v0.3 is the
 * morning-brief surface: a tight one-liner counting how many recent
 * HubSpot contacts are missing enrichable fields, with a per-field
 * breakdown.
 *
 * **No Apollo calls happen here.** The brief slice is a lightweight
 * count — it tells Ben "you have N contacts missing M fields total;
 * here's the breakdown" without burning Apollo budget on every
 * morning brief. The actual enrichment sweep is a separate operator
 * action (manual `POST /api/ops/sales/apollo-enrich/sweep` for now;
 * cron-scheduled in a future commit once volumes are observed).
 *
 * Pure functions only. No I/O. The HubSpot fetcher is shared with
 * the bulk-sweep route via `listRecentContacts`.
 */

/** Enrichable property keys we care about for the count. */
export const ENRICHABLE_FIELDS = [
  "firstname",
  "lastname",
  "jobtitle",
  "phone",
  "company",
  "city",
  "state",
] as const;

export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

/** Roll-up summary for the morning-brief slot. */
export interface EnrichmentOpportunitiesSummary {
  asOf: string;
  /** Total contacts scanned (denominator). */
  scanned: number;
  /** Contacts with at least one missing enrichable field. */
  missingAny: number;
  /** Per-field count of how many contacts are missing that field. */
  perField: Array<{ field: EnrichableField; count: number }>;
  /** Source citation per /contracts/governance.md §1 #2. */
  source: { system: "hubspot"; retrievedAt: string };
}

/** Truthy-but-empty check. Mirrors the `isEmpty` in apollo-enrichment.ts. */
function isMissing(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === "";
}

/**
 * Count how many of `ENRICHABLE_FIELDS` are missing on a single
 * HubSpot contact's properties block.
 */
export function missingFieldsForContact(
  properties: Record<string, string | null>,
): EnrichableField[] {
  const out: EnrichableField[] = [];
  for (const field of ENRICHABLE_FIELDS) {
    if (isMissing(properties[field])) out.push(field);
  }
  return out;
}

/**
 * Compute the morning-brief summary from a list of HubSpot contact
 * payloads + a `now` timestamp + the source citation.
 *
 * Only contacts WITH an email are counted (no email = not actionable
 * for follow-up). All other fields are projected as missing/present
 * via `missingFieldsForContact`.
 */
export function summarizeEnrichmentOpportunities(
  contacts: ReadonlyArray<{ id: string; properties: Record<string, string | null> }>,
  now: Date,
  retrievedAt: string,
): EnrichmentOpportunitiesSummary {
  const perFieldCount = new Map<EnrichableField, number>();
  for (const f of ENRICHABLE_FIELDS) perFieldCount.set(f, 0);

  let scanned = 0;
  let missingAny = 0;
  for (const c of contacts) {
    if (isMissing(c.properties.email)) continue;
    scanned += 1;
    const missing = missingFieldsForContact(c.properties);
    if (missing.length > 0) missingAny += 1;
    for (const field of missing) {
      perFieldCount.set(field, (perFieldCount.get(field) ?? 0) + 1);
    }
  }

  // Sort by count desc, then by alphabetical for stable rendering.
  const perField = Array.from(perFieldCount.entries())
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.field.localeCompare(b.field);
    })
    .filter((row) => row.count > 0);

  return {
    asOf: now.toISOString(),
    scanned,
    missingAny,
    perField,
    source: { system: "hubspot", retrievedAt },
  };
}
