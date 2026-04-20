/**
 * Vendor thread freshness — Gmail-driven signal for Ops Agent.
 *
 * For each watched vendor (ops.md contract §Read scope), scan Gmail
 * for the most recent inbound message from that vendor's domain and
 * return `{ lastInboundISO, lastSubject, lastSnippet, daysSince }`.
 *
 * "Inbound" means NOT sent by us (`-from:*@usagummies.com`). We only
 * count messages AT Ben — the vendor contacting us — because that's
 * what staleness is really measuring (did they stop responding?).
 *
 * Returns null for a vendor if Gmail is unreachable or has no
 * matching thread; the caller surfaces that as "unavailable" rather
 * than pretending the thread is fresh.
 */

import { listEmails } from "./gmail-reader";

/** Ops Agent's watch list (also hardcoded in its digest renderer). */
export interface WatchedVendor {
  name: string;
  /** Gmail query fragment: any `from:` domain that's this vendor. */
  fromQuery: string;
}

export const WATCHED_VENDORS: WatchedVendor[] = [
  { name: "Powers", fromQuery: "from:powers-inc.com OR from:powersconfections.com" },
  { name: "Belmark", fromQuery: "from:belmark.com" },
  { name: "Inderbitzin", fromQuery: "from:inderbitzin.com" },
  { name: "Albanese", fromQuery: "from:albaneseconfectionery.com OR from:albanesecandy.com" },
];

export interface VendorFreshness {
  vendor: string;
  lastInboundISO: string | null;
  lastSubject: string | null;
  lastSnippet: string | null;
  daysSince: number | null;
  unavailableReason?: string;
}

/**
 * Pull freshness for every watched vendor. Cheap — one Gmail search
 * per vendor, max 1 result each. Runs in parallel.
 */
export async function getAllVendorFreshness(): Promise<VendorFreshness[]> {
  return Promise.all(WATCHED_VENDORS.map(freshnessFor));
}

async function freshnessFor(vendor: WatchedVendor): Promise<VendorFreshness> {
  try {
    const query = `(${vendor.fromQuery}) -from:usagummies.com newer_than:60d`;
    const envs = await listEmails({ query, count: 1 });
    if (envs.length === 0) {
      return {
        vendor: vendor.name,
        lastInboundISO: null,
        lastSubject: null,
        lastSnippet: null,
        daysSince: null,
        unavailableReason: "no inbound mail in last 60 days",
      };
    }
    const env = envs[0];
    const lastTime = new Date(env.date);
    const daysSince = Math.max(
      0,
      Math.floor((Date.now() - lastTime.getTime()) / (24 * 3600 * 1000)),
    );
    return {
      vendor: vendor.name,
      lastInboundISO: lastTime.toISOString(),
      lastSubject: env.subject?.slice(0, 140) ?? null,
      lastSnippet: env.snippet?.slice(0, 200) ?? null,
      daysSince,
    };
  } catch (err) {
    return {
      vendor: vendor.name,
      lastInboundISO: null,
      lastSubject: null,
      lastSnippet: null,
      daysSince: null,
      unavailableReason: `gmail query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
