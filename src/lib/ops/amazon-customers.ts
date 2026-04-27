/**
 * Amazon FBM customer registry — Phase 28k.
 *
 * The auto-ship pipeline reads Amazon orders from ShipStation +
 * pulls quantities from SP-API, ships the package, posts to Slack,
 * persists artifacts to KV. None of those steps remember the BUYER —
 * if "ann (Molak) at 3 Spindrift Way Barrington RI" orders again
 * next month, the system has no memory of her.
 *
 * This module is the missing memory:
 *   - Stable fingerprint per (lowercased name, ZIP) tuple — survives
 *     small variations in shipTo formatting.
 *   - One KV record per fingerprint, upserted on every Amazon FBM
 *     auto-ship. Aggregates orderCount + totalBags + totalRevenueUsd
 *     and keeps the most-recent N orders for tail observability.
 *   - Pure helpers + small async surface; the auto-ship route fires
 *     `recordAmazonOrderShipped()` after the audit lands. List route
 *     scans + projects.
 *
 * Hard rules:
 *   - **PII is the same we already have** in ShipStation + audit log.
 *     This module just makes it queryable. No new external write.
 *   - **Fail-soft on every operation.** A KV outage during upsert
 *     NEVER blocks the auto-ship pipeline — the customer record is
 *     downstream observability, not the source of truth.
 *   - **No fabrication.** Missing fields surface as `null`. Repeat
 *     count is an exact count, not "approximately" anything.
 *   - **TTL — 1 year for first-time buyers, 3 years on repeat.**
 *     Repeat buyers are more useful to remember; one-and-done buyers
 *     phase out.
 */
import { kv } from "@vercel/kv";

const KV_PREFIX = "amazon:customer:";
const TTL_FIRST_TIME_SECONDS = 365 * 24 * 3600; // 1 year
const TTL_REPEAT_SECONDS = 3 * 365 * 24 * 3600; // 3 years
const RECENT_ORDERS_CAP = 10;

export interface AmazonCustomerRecord {
  /** Stable fingerprint — `${lowercased-name}|${zip5}`. Slugged. */
  fingerprint: string;
  /** Last-seen recipient name as Amazon sent it (preserves original case). */
  shipToName: string;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  /** ISO timestamp of the FIRST order we saw from this fingerprint. */
  firstSeenAt: string;
  /** ISO timestamp of the most recent order. */
  lastSeenAt: string;
  /** Exact count of distinct orders we've shipped. */
  orderCount: number;
  /** Sum of bags across all orders. */
  totalBags: number;
  /** Sum of OrderTotal across orders where we have it. null entries skipped. */
  totalRevenueUsd: number;
  /** Sum of shipping cost we paid across all orders. */
  totalShippingCostUsd: number;
  /** Most-recent N orders, newest first. Capped at RECENT_ORDERS_CAP. */
  recentOrders: AmazonCustomerOrderEntry[];
}

export interface AmazonCustomerOrderEntry {
  orderNumber: string;
  shippedAt: string;
  bags: number;
  /** Shipping label cost (what WE paid). */
  shippingCostUsd: number | null;
  /** Order total in USD (what the buyer paid Amazon). null when unknown. */
  revenueUsd: number | null;
  trackingNumber: string | null;
}

/**
 * Compute a stable fingerprint for an Amazon shipTo. Collapses
 * common formatting variation (case, surrounding whitespace,
 * non-alphanumeric, ZIP+4 → ZIP5) so the same buyer placing orders
 * across weeks lands on the same key.
 *
 * Returns null when we don't have enough to fingerprint (no name OR
 * no ZIP). null fingerprints get dropped — better to lose a record
 * than collide multiple buyers under a noisy default.
 */
export function computeAmazonCustomerFingerprint(input: {
  shipToName: string | null | undefined;
  shipToPostalCode: string | null | undefined;
}): string | null {
  const nameRaw = (input.shipToName ?? "").trim().toLowerCase();
  // Strip non-alphanumeric AND collapse whitespace runs.
  const name = nameRaw
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return null;
  const zipRaw = (input.shipToPostalCode ?? "").trim();
  const zip5Match = zipRaw.match(/^\d{5}/);
  const zip5 = zip5Match ? zip5Match[0] : null;
  if (!zip5) return null;
  return `${name}|${zip5}`;
}

function kvKeyForFingerprint(fingerprint: string): string {
  return `${KV_PREFIX}${fingerprint}`;
}

export interface RecordAmazonOrderShippedInput {
  orderNumber: string;
  shippedAt?: string; // ISO; defaults to now
  shipToName: string | null | undefined;
  shipToCity?: string | null;
  shipToState?: string | null;
  shipToPostalCode: string | null | undefined;
  bags: number;
  /** What WE paid for the label. */
  shippingCostUsd?: number | null;
  /** Buyer-paid total (Amazon OrderTotal.Amount). null when unknown. */
  revenueUsd?: number | null;
  trackingNumber?: string | null;
}

/**
 * Upsert one shipped order into the customer registry.
 *
 * Returns:
 *   - `ok: true, fingerprint, isFirstOrder`: success path. `isFirstOrder`
 *     is true when this was a new customer (no prior record found).
 *   - `ok: true, fingerprint: null, isFirstOrder: null`: skipped — not
 *     enough shipTo info to fingerprint. NOT an error.
 *   - `ok: false, error`: KV failure. Caller treats as best-effort —
 *     the auto-ship pipeline doesn't roll back.
 *
 * Pure-side-effect-on-KV operation: idempotent ONLY at the
 * (fingerprint, orderNumber) tuple level — re-calling with the same
 * orderNumber doesn't double-count (we de-dupe `recentOrders` by
 * orderNumber before incrementing aggregates).
 */
export async function recordAmazonOrderShipped(
  input: RecordAmazonOrderShippedInput,
): Promise<{
  ok: boolean;
  fingerprint: string | null;
  isFirstOrder: boolean | null;
  error?: string;
}> {
  const fingerprint = computeAmazonCustomerFingerprint({
    shipToName: input.shipToName,
    shipToPostalCode: input.shipToPostalCode,
  });
  if (!fingerprint) {
    return { ok: true, fingerprint: null, isFirstOrder: null };
  }
  const now = input.shippedAt ?? new Date().toISOString();
  try {
    const existing = await getAmazonCustomer(fingerprint);
    const isFirstOrder = existing === null;

    // Build the next-state record.
    const orderEntry: AmazonCustomerOrderEntry = {
      orderNumber: input.orderNumber,
      shippedAt: now,
      bags: Math.max(0, Math.floor(input.bags)),
      shippingCostUsd: numberOrNull(input.shippingCostUsd),
      revenueUsd: numberOrNull(input.revenueUsd),
      trackingNumber: input.trackingNumber ?? null,
    };

    // Idempotency: if the orderNumber is already in recentOrders,
    // refresh in-place rather than double-count aggregates.
    let recentOrders = existing?.recentOrders ?? [];
    const existingIdx = recentOrders.findIndex(
      (o) => o.orderNumber === input.orderNumber,
    );
    let isReplay = false;
    if (existingIdx >= 0) {
      isReplay = true;
      recentOrders = [
        orderEntry,
        ...recentOrders.filter((o) => o.orderNumber !== input.orderNumber),
      ].slice(0, RECENT_ORDERS_CAP);
    } else {
      recentOrders = [orderEntry, ...recentOrders].slice(0, RECENT_ORDERS_CAP);
    }

    // Aggregate updates: only increment when NOT a replay.
    const aggregateBags = isReplay
      ? existing?.totalBags ?? 0
      : (existing?.totalBags ?? 0) + orderEntry.bags;
    const aggregateRevenue = isReplay
      ? existing?.totalRevenueUsd ?? 0
      : (existing?.totalRevenueUsd ?? 0) + (orderEntry.revenueUsd ?? 0);
    const aggregateShipping = isReplay
      ? existing?.totalShippingCostUsd ?? 0
      : (existing?.totalShippingCostUsd ?? 0) +
        (orderEntry.shippingCostUsd ?? 0);
    const aggregateOrders = isReplay
      ? existing?.orderCount ?? 1
      : (existing?.orderCount ?? 0) + 1;

    const next: AmazonCustomerRecord = {
      fingerprint,
      shipToName: input.shipToName?.trim() || existing?.shipToName || "",
      shipToCity: input.shipToCity ?? existing?.shipToCity ?? null,
      shipToState: input.shipToState ?? existing?.shipToState ?? null,
      shipToPostalCode:
        input.shipToPostalCode?.trim() || existing?.shipToPostalCode || null,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      orderCount: aggregateOrders,
      totalBags: aggregateBags,
      totalRevenueUsd: round2(aggregateRevenue),
      totalShippingCostUsd: round2(aggregateShipping),
      recentOrders,
    };

    const ttl =
      next.orderCount > 1 ? TTL_REPEAT_SECONDS : TTL_FIRST_TIME_SECONDS;
    await kv.set(kvKeyForFingerprint(fingerprint), JSON.stringify(next), {
      ex: ttl,
    });
    return { ok: true, fingerprint, isFirstOrder };
  } catch (err) {
    return {
      ok: false,
      fingerprint,
      isFirstOrder: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fetch one customer record by fingerprint. null on miss, KV throw,
 * or malformed JSON. Never throws.
 */
export async function getAmazonCustomer(
  fingerprint: string,
): Promise<AmazonCustomerRecord | null> {
  try {
    const v = await kv.get<string | AmazonCustomerRecord>(
      kvKeyForFingerprint(fingerprint),
    );
    if (!v) return null;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as AmazonCustomerRecord;
      } catch {
        return null;
      }
    }
    return v as AmazonCustomerRecord;
  } catch {
    return null;
  }
}

export type AmazonCustomerSortBy =
  | "lastSeen"
  | "firstSeen"
  | "orderCount"
  | "totalRevenue";

/**
 * List all customers in the registry. Bounded scan via `kv.scan` —
 * the registry is tiny enough (one record per unique buyer-zip
 * tuple) to fit comfortably in a single page for now. Sort applied
 * post-projection.
 */
export async function listAmazonCustomers(opts?: {
  limit?: number;
  sortBy?: AmazonCustomerSortBy;
  /** When true, only customers with orderCount > 1. */
  repeatOnly?: boolean;
}): Promise<AmazonCustomerRecord[]> {
  const limit = clampInt(opts?.limit, 100, 1, 500);
  const sortBy: AmazonCustomerSortBy = opts?.sortBy ?? "lastSeen";
  const records: AmazonCustomerRecord[] = [];
  try {
    let cursor: string | number = 0;
    const matchKey = `${KV_PREFIX}*`;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const scanResult = (await kv.scan(cursor, {
        match: matchKey,
        count: 200,
      })) as unknown as [string | number, string[]];
      const [next, keys] = scanResult;
      for (const key of keys) {
        const v = await kv.get<string | AmazonCustomerRecord>(key);
        if (!v) continue;
        let rec: AmazonCustomerRecord;
        if (typeof v === "object" && v !== null && "fingerprint" in v) {
          rec = v as AmazonCustomerRecord;
        } else if (typeof v === "string") {
          try {
            rec = JSON.parse(v) as AmazonCustomerRecord;
          } catch {
            continue;
          }
        } else {
          continue;
        }
        if (opts?.repeatOnly && rec.orderCount <= 1) continue;
        records.push(rec);
      }
      if (Number(next) === 0 || next === "0") break;
      cursor = next;
    }
  } catch {
    // Fail-soft: caller sees an empty list rather than a stack trace.
    return [];
  }
  return sortAmazonCustomers(records, sortBy).slice(0, limit);
}

/** Pure sort helper — exported for tests. Stable on ties via fingerprint. */
export function sortAmazonCustomers(
  records: AmazonCustomerRecord[],
  sortBy: AmazonCustomerSortBy,
): AmazonCustomerRecord[] {
  const arr = [...records];
  arr.sort((a, b) => {
    let cmp = 0;
    if (sortBy === "lastSeen") cmp = compareDescIso(a.lastSeenAt, b.lastSeenAt);
    else if (sortBy === "firstSeen")
      cmp = compareDescIso(a.firstSeenAt, b.firstSeenAt);
    else if (sortBy === "orderCount") cmp = b.orderCount - a.orderCount;
    else if (sortBy === "totalRevenue")
      cmp = b.totalRevenueUsd - a.totalRevenueUsd;
    if (cmp !== 0) return cmp;
    return a.fingerprint < b.fingerprint ? -1 : 1;
  });
  return arr;
}

export interface AmazonCustomerCounts {
  total: number;
  repeat: number;
  oneAndDone: number;
  totalOrders: number;
  totalBags: number;
  totalRevenueUsd: number;
}

/** Summary counts across the full record list. Pure. */
export function summarizeAmazonCustomers(
  records: readonly AmazonCustomerRecord[],
): AmazonCustomerCounts {
  let totalOrders = 0;
  let totalBags = 0;
  let totalRevenue = 0;
  let repeat = 0;
  for (const r of records) {
    totalOrders += r.orderCount;
    totalBags += r.totalBags;
    totalRevenue += r.totalRevenueUsd;
    if (r.orderCount > 1) repeat += 1;
  }
  return {
    total: records.length,
    repeat,
    oneAndDone: records.length - repeat,
    totalOrders,
    totalBags,
    totalRevenueUsd: round2(totalRevenue),
  };
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function numberOrNull(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function compareDescIso(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

function clampInt(
  raw: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}
