/**
 * Booke integration — categorize queue feed.
 *
 * Booke (third-party SaaS) owns the auto-categorize workflow on the
 * QBO bank feed. Our Finance Exception Agent needs to surface the
 * size of Booke's pending queue so Rene knows how deep Booke is
 * behind each morning.
 *
 * Two paths are supported here:
 *
 *   1. **Direct API** — `BOOKE_API_TOKEN` env var hits Booke's REST
 *      API (`https://api.booke.ai/api/v1/...`). Their public API
 *      exposes a `transactions` endpoint with status filters; pending
 *      = `queued` + `pending_review`. Stays empty until Ben/Rene
 *      provisions the token.
 *
 *   2. **KV cache** — for setups where Booke pushes state via a
 *      webhook or a Zapier bridge rather than giving us a direct
 *      token, we read the KV key `booke:uncategorized_count` with
 *      an `updatedAt` stamp. If nothing has written to that key in
 *      the last 24h we treat it as stale.
 *
 * Whichever path returns a value first wins; degraded reason is
 * propagated up so the Finance Exception Agent surfaces an honest
 * `unavailable` line instead of a stale number.
 */

import { kv } from "@vercel/kv";

const KV_BOOKE_COUNT = "booke:uncategorized_count";
const STALE_AFTER_MS = 24 * 3600 * 1000;

export interface BookeQueueState {
  pendingCount: number | null;
  source: "api" | "kv" | null;
  retrievedAt: string;
  unavailableReason?: string;
}

interface BookeKvEntry {
  count: number;
  updatedAt: string;
}

/**
 * Best-effort fetch of Booke's pending categorization queue size.
 * Never throws — always returns a `BookeQueueState` so Finance
 * Exception Agent can render a clean line regardless.
 */
export async function getBookeQueueState(): Promise<BookeQueueState> {
  const apiResult = await tryBookeApi();
  if (apiResult.pendingCount !== null) return apiResult;

  const kvResult = await tryKv();
  if (kvResult.pendingCount !== null) return kvResult;

  return {
    pendingCount: null,
    source: null,
    retrievedAt: new Date().toISOString(),
    unavailableReason:
      apiResult.unavailableReason ??
      kvResult.unavailableReason ??
      "no Booke source reachable",
  };
}

async function tryBookeApi(): Promise<BookeQueueState> {
  const token = process.env.BOOKE_API_TOKEN?.trim();
  if (!token) {
    return {
      pendingCount: null,
      source: "api",
      retrievedAt: new Date().toISOString(),
      unavailableReason: "BOOKE_API_TOKEN not configured",
    };
  }
  try {
    const res = await fetch(
      "https://api.booke.ai/api/v1/transactions?status=queued,pending_review&limit=1",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      return {
        pendingCount: null,
        source: "api",
        retrievedAt: new Date().toISOString(),
        unavailableReason: `Booke API ${res.status}`,
      };
    }
    const body = (await res.json()) as { total?: number; count?: number; meta?: { total?: number } };
    const pendingCount =
      typeof body.total === "number"
        ? body.total
        : typeof body.meta?.total === "number"
          ? body.meta.total
          : typeof body.count === "number"
            ? body.count
            : null;
    if (pendingCount === null) {
      return {
        pendingCount: null,
        source: "api",
        retrievedAt: new Date().toISOString(),
        unavailableReason: "Booke API returned no total/count field",
      };
    }
    return {
      pendingCount,
      source: "api",
      retrievedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      pendingCount: null,
      source: "api",
      retrievedAt: new Date().toISOString(),
      unavailableReason: `Booke API threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function tryKv(): Promise<BookeQueueState> {
  try {
    const entry = await kv.get<BookeKvEntry>(KV_BOOKE_COUNT);
    if (!entry || typeof entry.count !== "number") {
      return {
        pendingCount: null,
        source: "kv",
        retrievedAt: new Date().toISOString(),
        unavailableReason: "no KV entry for booke:uncategorized_count",
      };
    }
    const ageMs = Date.now() - new Date(entry.updatedAt).getTime();
    if (ageMs > STALE_AFTER_MS) {
      return {
        pendingCount: null,
        source: "kv",
        retrievedAt: entry.updatedAt,
        unavailableReason: `KV entry stale (${Math.round(ageMs / 3600_000)}h old)`,
      };
    }
    return {
      pendingCount: entry.count,
      source: "kv",
      retrievedAt: entry.updatedAt,
    };
  } catch (err) {
    return {
      pendingCount: null,
      source: "kv",
      retrievedAt: new Date().toISOString(),
      unavailableReason: `KV read threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Administrative writer — called by a webhook (/api/ops/booke/push)
 * when Booke pushes an updated count to us, or by a manual script.
 */
export async function setBookeQueueCount(count: number): Promise<BookeKvEntry> {
  const entry: BookeKvEntry = {
    count: Math.max(0, Math.round(count)),
    updatedAt: new Date().toISOString(),
  };
  await kv.set(KV_BOOKE_COUNT, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Viktor W-9 read API — list helpers
// ---------------------------------------------------------------------------
//
// Per `/contracts/viktor.md` v3.2 W-9 ("Finance close-loop"). Read-only
// list helpers Viktor uses to pull Booke's To Review queue + account /
// vendor reference data when proposing category mappings.
//
// Each function returns a discriminated `BookeReadResult<T>` so callers
// can branch on `configured` vs `unconfigured` vs `errored` without
// guessing. When `BOOKE_API_TOKEN` is absent every helper returns
// `{ ok: false, configured: false }` cleanly — existing flows are
// unaffected; the readiness page surfaces "not configured" so an
// operator can see what's missing.
//
// NEVER paste a Booke password / token in Slack / source / logs. Token
// lives in `BOOKE_API_TOKEN` Vercel env var only.

const BOOKE_API_BASE = "https://api.booke.ai/api/v1";

export interface BookeUnreviewedTransaction {
  id: string;
  date: string;
  vendor: string | null;
  amount: number;
  description: string;
  /** Currently-suggested category from Booke's classifier. */
  suggestedCategory: string | null;
  /** Confidence 0..1, when Booke surfaces it. */
  suggestedConfidence: number | null;
  /** Source bank/feed (BoA, Capital One, Amazon, etc.). */
  source: string;
}

export interface BookeAccount {
  id: string;
  name: string;
  qboAccountNumber: string | null;
  type: string;
}

export interface BookeVendor {
  id: string;
  name: string;
  qboVendorId: string | null;
}

export type BookeReadResult<T> =
  | { ok: true; configured: true; data: T }
  | { ok: false; configured: false; reason: "BOOKE_API_TOKEN not configured" }
  | { ok: false; configured: true; reason: string };

const NOT_CONFIGURED = {
  ok: false as const,
  configured: false as const,
  reason: "BOOKE_API_TOKEN not configured" as const,
};

/** Returns true iff `BOOKE_API_TOKEN` is set (no other validation). */
export function isBookeConfigured(): boolean {
  return Boolean(process.env.BOOKE_API_TOKEN?.trim());
}

/**
 * List transactions in Booke's "To Review" queue.
 *
 * Wiring placeholder: when Booke's partner API contract is confirmed,
 * the inner fetch stays the same; only the response-parser updates.
 */
export async function listToReviewTransactions(opts: {
  limit?: number;
  fetchImpl?: typeof fetch;
} = {}): Promise<BookeReadResult<BookeUnreviewedTransaction[]>> {
  if (!isBookeConfigured()) return NOT_CONFIGURED;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `${BOOKE_API_BASE}/transactions?status=queued,pending_review&limit=${opts.limit ?? 50}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.BOOKE_API_TOKEN!.trim()}`,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        reason: `Booke API ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      transactions?: BookeUnreviewedTransaction[];
    };
    return {
      ok: true,
      configured: true,
      data: Array.isArray(body.transactions) ? body.transactions : [],
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function listAccounts(opts: {
  fetchImpl?: typeof fetch;
} = {}): Promise<BookeReadResult<BookeAccount[]>> {
  if (!isBookeConfigured()) return NOT_CONFIGURED;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${BOOKE_API_BASE}/accounts`, {
      headers: {
        Authorization: `Bearer ${process.env.BOOKE_API_TOKEN!.trim()}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        reason: `Booke API ${res.status}`,
      };
    }
    const body = (await res.json()) as { accounts?: BookeAccount[] };
    return {
      ok: true,
      configured: true,
      data: Array.isArray(body.accounts) ? body.accounts : [],
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function listVendors(opts: {
  fetchImpl?: typeof fetch;
} = {}): Promise<BookeReadResult<BookeVendor[]>> {
  if (!isBookeConfigured()) return NOT_CONFIGURED;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${BOOKE_API_BASE}/vendors`, {
      headers: {
        Authorization: `Bearer ${process.env.BOOKE_API_TOKEN!.trim()}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        reason: `Booke API ${res.status}`,
      };
    }
    const body = (await res.json()) as { vendors?: BookeVendor[] };
    return {
      ok: true,
      configured: true,
      data: Array.isArray(body.vendors) ? body.vendors : [],
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Returns the typed data array, or [] when the read failed. UI helper. */
export function unwrapOrEmpty<T>(r: BookeReadResult<T[]>): T[] {
  return r.ok ? r.data : [];
}
