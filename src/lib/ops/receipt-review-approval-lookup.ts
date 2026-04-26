/**
 * Phase 19 (Option B) — canonical, KV-cached approval lookup for
 * the receipt-review-packet routes.
 *
 * Both `/api/ops/docs/receipt-review-packets` (the JSON list) and
 * `/api/ops/docs/receipt-review-packets/export.csv` (the CSV
 * export) call this same helper to map `packetId →
 * { approvalId, approvalStatus }`. Phases 13/15/16/17/18 had two
 * inlined copies of `buildApprovalLookup()` — this module
 * deduplicates them and adds a short-TTL KV cache so the bounded
 * passive poll (Phase 15, every 60s on every active client)
 * doesn't repeatedly hammer `approvalStore.listPending()` +
 * `listByAgent()`.
 *
 * Hard rules (locked by tests):
 *   - **Read-only.** No KV/HubSpot/QBO/Shopify/Slack mutation
 *     other than the cache write itself (which only stores read
 *     results, not state).
 *   - **30-second TTL.** Worst-case staleness for the operator
 *     dashboard is the TTL window. Acceptable trade-off vs.
 *     repeated `approvalStore` reads. The bounded passive poll
 *     respects the TTL — operators see the fresh state on the
 *     tick after expiry.
 *   - **No fabrication on outage.** If `approvalStore.listPending`
 *     OR `listByAgent` throws, we fall back to a partial map (same
 *     fail-soft contract as the previous inlined copies).
 *   - **Defensive cache reads.** A garbage / unparseable cached
 *     value falls through to a fresh build. The cache layer
 *     NEVER masks the underlying source of truth.
 *   - **Cache write is best-effort.** A KV write failure returns
 *     the freshly-built result anyway — caller doesn't see the
 *     write error.
 */
import { kv } from "@vercel/kv";

import { approvalStore } from "./control-plane/stores";
import type { ApprovalsByPacketId } from "@/app/ops/finance/review-packets/data";

/** Cache key — versioned so a future shape change forces a clean
 *  rollout. Bump the suffix when changing the serialized shape. */
const CACHE_KEY = "approval-lookup:receipt-review:v1";

/** TTL in seconds. 30s is short enough that operators see closer
 *  transitions on the tick after expiry; long enough that a
 *  multi-tab operator session doesn't keep rebuilding the lookup. */
const CACHE_TTL_SECONDS = 30;

/** Internal exports for tests. Production code should use
 *  `getCachedApprovalLookup()`. */
export const __INTERNAL = {
  CACHE_KEY,
  CACHE_TTL_SECONDS,
};

/**
 * Build the lookup from scratch. Read-only; both store reads
 * fail-soft so a partial map is preferred over a throw. Pending
 * approvals win on conflict (a packet whose approval is `pending`
 * via `listPending` should NEVER be overwritten by a stale
 * terminal-state row from `listByAgent`).
 *
 * Exported for tests + for callers that need to bypass the cache
 * (e.g. a future "force refresh" admin button). Production routes
 * should use `getCachedApprovalLookup()`.
 */
export async function buildApprovalLookupFresh(): Promise<ApprovalsByPacketId> {
  const map: ApprovalsByPacketId = new Map();
  const store = approvalStore();
  try {
    const pending = await store.listPending();
    for (const a of pending) {
      const id = a.targetEntity?.id;
      if (typeof id === "string" && id.length > 0) {
        map.set(id, { id: a.id, status: a.status });
      }
    }
  } catch {
    // partial — continue with the listByAgent fallback
  }
  try {
    const recent = await store.listByAgent("ops-route:receipt-promote", 200);
    for (const a of recent) {
      const id = a.targetEntity?.id;
      if (typeof id === "string" && id.length > 0) {
        // Don't overwrite a pending entry with the older terminal
        // state; the pending lookup wins on conflict.
        if (!map.has(id)) {
          map.set(id, { id: a.id, status: a.status });
        }
      }
    }
  } catch {
    // partial — already accumulated whatever listPending returned
  }
  return map;
}

/** Cache-stored shape: a flat object so JSON serialization is
 *  trivial. Map<>() is not JSON-serializable directly. */
interface CachedShape {
  /** Unix-ms timestamp of when the cache was written. Lets
   *  consumers verify TTL even if KV's `ex:` enforcement lags. */
  cachedAt: number;
  /** Flat record keyed on packetId (= targetEntity.id). */
  entries: Record<string, { id: string; status: string }>;
}

function isValidCachedShape(value: unknown): value is CachedShape {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.cachedAt !== "number" || !Number.isFinite(v.cachedAt)) return false;
  if (v.entries === null || typeof v.entries !== "object") return false;
  // Sanity check: every entry has the expected shape. We don't
  // need to validate every key — one malformed entry can be
  // skipped, but if the whole `entries` field isn't an object
  // we fall through to a fresh build.
  return true;
}

function deserializeMap(shape: CachedShape): ApprovalsByPacketId {
  const map: ApprovalsByPacketId = new Map();
  for (const [packetId, info] of Object.entries(shape.entries)) {
    if (
      info &&
      typeof info === "object" &&
      typeof (info as { id?: unknown }).id === "string" &&
      typeof (info as { status?: unknown }).status === "string"
    ) {
      map.set(packetId, info as { id: string; status: string });
    }
  }
  return map;
}

function serializeMap(map: ApprovalsByPacketId): CachedShape {
  const entries: Record<string, { id: string; status: string }> = {};
  for (const [packetId, info] of map.entries()) {
    entries[packetId] = info;
  }
  return { cachedAt: Date.now(), entries };
}

/**
 * Get the approval lookup, preferring the KV-cached value when
 * fresh. Read-only on the underlying source of truth; the cache
 * write is best-effort (never throws back to the caller).
 *
 * Cache miss flow:
 *   1. KV.get returns null / undefined / unparseable → fresh build
 *   2. Fresh build runs (fail-soft on partial source failures)
 *   3. KV.set runs with `{ ex: CACHE_TTL_SECONDS }` (best-effort)
 *   4. Return the freshly-built map
 *
 * Cache hit flow:
 *   1. KV.get returns a valid CachedShape with `cachedAt` ≤ TTL
 *   2. Deserialize → return Map
 *
 * Defensive fallthroughs:
 *   - KV.get throws → fresh build, no cache write
 *   - Cached value fails shape check → fresh build, write fresh
 *   - Cached value is older than TTL (KV TTL didn't fire) →
 *     fresh build, write fresh
 *   - KV.set throws → return freshly-built map without surfacing
 *     the write error
 */
export async function getCachedApprovalLookup(): Promise<ApprovalsByPacketId> {
  const { map } = await getCachedApprovalLookupWithMeta();
  return map;
}

/**
 * Phase 24 — variant of `getCachedApprovalLookup` that ALSO returns
 * the cache age metadata. Used by the list route to surface "as of
 * Xs ago" to operators on the dashboard so they can tell whether
 * the view they're seeing was just rebuilt or is being served from
 * the 30s TTL window.
 *
 * `cachedAt` is:
 *   - `null` when the lookup was freshly built (cache miss / stale /
 *     garbage / future-dated cachedAt / KV.get throw fallthrough).
 *   - The cached value's `cachedAt` Unix-ms timestamp when served
 *     from cache (within the TTL window).
 *
 * The plain `getCachedApprovalLookup()` is a thin wrapper around
 * this — preserved for backward-compat with the CSV export route
 * and the Phase 20/22 callers that don't care about cache age.
 *
 * Same defensive fallthroughs and best-effort cache-write contract
 * as the wrapper. KV.set throws are swallowed; the freshly-built
 * map is still returned with `cachedAt: null`.
 */
export interface CachedApprovalLookupMeta {
  map: ApprovalsByPacketId;
  /** Unix-ms timestamp from the cache entry when served from cache;
   *  `null` when freshly built. NEVER fabricated as 0 / -1 / now. */
  cachedAt: number | null;
}

export async function getCachedApprovalLookupWithMeta(): Promise<CachedApprovalLookupMeta> {
  let cached: unknown = null;
  try {
    cached = await kv.get(CACHE_KEY);
  } catch {
    cached = null;
  }
  if (isValidCachedShape(cached)) {
    const ageMs = Date.now() - cached.cachedAt;
    if (ageMs >= 0 && ageMs <= CACHE_TTL_SECONDS * 1000) {
      return { map: deserializeMap(cached), cachedAt: cached.cachedAt };
    }
  }
  // Cache miss / stale / garbage / KV throw → fresh build.
  const fresh = await buildApprovalLookupFresh();
  // Best-effort write. Never propagate the write error.
  try {
    await kv.set(CACHE_KEY, serializeMap(fresh), {
      ex: CACHE_TTL_SECONDS,
    });
  } catch {
    // ignore
  }
  return { map: fresh, cachedAt: null };
}

/**
 * Invalidate the cached lookup. Useful from admin-side refresh
 * paths or from places that know the underlying state just
 * changed (e.g. immediately after the Phase 10 closer flips a
 * packet). Best-effort — KV failures are swallowed.
 */
export async function invalidateApprovalLookupCache(): Promise<void> {
  try {
    await kv.del(CACHE_KEY);
  } catch {
    // ignore
  }
}
