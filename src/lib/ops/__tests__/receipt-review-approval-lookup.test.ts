/**
 * Phase 19 (Option B) — tests for the canonical KV-cached approval
 * lookup helper.
 *
 * Locked rules:
 *   - Cache miss → fresh build → KV.set with TTL → return fresh.
 *   - Cache hit (within TTL) → return cached without rebuilding.
 *   - KV.get throws → fresh build, no cache write attempted with the
 *     thrown value (best-effort write may still run after).
 *   - Garbage cached value → falls through to fresh build.
 *   - Stale cached value (older than TTL, KV ex didn't fire) →
 *     falls through to fresh build.
 *   - KV.set throws → fresh result still returned to caller (write
 *     error never propagates).
 *   - `invalidateApprovalLookupCache()` clears the key.
 *   - Pending approvals win on conflict with terminal-state rows.
 *   - Both store reads fail-soft: an error in `listPending` does not
 *     prevent `listByAgent` results from being included; an error in
 *     `listByAgent` does not lose `listPending` results.
 *   - `__INTERNAL` exposes CACHE_KEY + CACHE_TTL_SECONDS for lockstep
 *     assertions in other tests.
 *   - Static-source: the module imports nothing from QBO writes,
 *     HubSpot, Shopify writes, Slack send paths, or
 *     `openApproval` / `buildApprovalRequest`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalRequest } from "@/lib/ops/control-plane/types";

// ---------------------------------------------------------------------------
// KV mock — a Map-backed store with knobs for "throw on get" / "throw on set"
// ---------------------------------------------------------------------------

const kvBacking = new Map<string, unknown>();
let kvGetShouldThrow = false;
let kvSetShouldThrow = false;
let kvDelShouldThrow = false;
let lastKvSetCall: { key: string; value: unknown; opts?: unknown } | null = null;

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => {
      if (kvGetShouldThrow) throw new Error("kv-get-failed");
      return kvBacking.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: unknown, opts?: unknown) => {
      lastKvSetCall = { key, value, opts };
      if (kvSetShouldThrow) throw new Error("kv-set-failed");
      kvBacking.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      if (kvDelShouldThrow) throw new Error("kv-del-failed");
      kvBacking.delete(key);
    }),
  },
}));

// ---------------------------------------------------------------------------
// Approval store mock — counts calls so we can assert the cache hit path
// avoids rebuilding.
// ---------------------------------------------------------------------------

let listPendingCalls = 0;
let listByAgentCalls = 0;
let pendingFixture: ApprovalRequest[] = [];
let byAgentFixture: ApprovalRequest[] = [];
let pendingShouldThrow = false;
let byAgentShouldThrow = false;

vi.mock("@/lib/ops/control-plane/stores", () => ({
  approvalStore: () => ({
    listPending: vi.fn(async () => {
      listPendingCalls += 1;
      if (pendingShouldThrow) throw new Error("listPending-failed");
      return pendingFixture;
    }),
    listByAgent: vi.fn(async () => {
      listByAgentCalls += 1;
      if (byAgentShouldThrow) throw new Error("listByAgent-failed");
      return byAgentFixture;
    }),
  }),
}));

// Imports MUST come after the mocks above.
import {
  __INTERNAL,
  buildApprovalLookupFresh,
  getCachedApprovalLookup,
  getCachedApprovalLookupWithMeta,
  invalidateApprovalLookupCache,
} from "@/lib/ops/receipt-review-approval-lookup";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeApproval(
  overrides: Partial<ApprovalRequest> & {
    targetEntityId?: string | undefined;
  } = {},
): ApprovalRequest {
  const targetEntityId = overrides.targetEntityId;
  delete (overrides as { targetEntityId?: string }).targetEntityId;
  return {
    id: overrides.id ?? "appr_" + Math.random().toString(36).slice(2),
    runId: overrides.runId ?? "run_x",
    division: overrides.division ?? "ops",
    actorAgentId: overrides.actorAgentId ?? "ops-route:receipt-promote",
    class: overrides.class ?? "B",
    action: overrides.action ?? "receipt.review.promote",
    targetSystem: overrides.targetSystem ?? "qbo",
    targetEntity:
      overrides.targetEntity ??
      (targetEntityId
        ? { type: "receipt-review-packet", id: targetEntityId }
        : undefined),
    payloadPreview: overrides.payloadPreview ?? "",
    evidence: overrides.evidence ?? {
      claim: "",
      sources: [],
      confidence: 0.9,
    },
    rollbackPlan: overrides.rollbackPlan ?? "",
    requiredApprovers: overrides.requiredApprovers ?? [],
    status: overrides.status ?? "pending",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    decisions: overrides.decisions ?? [],
    escalateAt: overrides.escalateAt ?? new Date().toISOString(),
    expiresAt: overrides.expiresAt ?? new Date().toISOString(),
  } as ApprovalRequest;
}

beforeEach(() => {
  kvBacking.clear();
  kvGetShouldThrow = false;
  kvSetShouldThrow = false;
  kvDelShouldThrow = false;
  lastKvSetCall = null;
  listPendingCalls = 0;
  listByAgentCalls = 0;
  pendingFixture = [];
  byAgentFixture = [];
  pendingShouldThrow = false;
  byAgentShouldThrow = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// __INTERNAL — locked constants
// ---------------------------------------------------------------------------

describe("__INTERNAL constants", () => {
  it("exposes CACHE_KEY (versioned) and CACHE_TTL_SECONDS (30)", () => {
    expect(__INTERNAL.CACHE_KEY).toBe("approval-lookup:receipt-review:v1");
    expect(__INTERNAL.CACHE_TTL_SECONDS).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// buildApprovalLookupFresh — the cache-bypassing canonical builder
// ---------------------------------------------------------------------------

describe("buildApprovalLookupFresh", () => {
  it("returns a Map keyed on targetEntity.id with {id, status}", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
      makeApproval({ id: "a2", targetEntityId: "pkt-2", status: "pending" }),
    ];
    const map = await buildApprovalLookupFresh();
    expect(map.get("pkt-1")).toEqual({ id: "a1", status: "pending" });
    expect(map.get("pkt-2")).toEqual({ id: "a2", status: "pending" });
    expect(map.size).toBe(2);
  });

  it("skips approvals with no targetEntity.id (defensive)", async () => {
    pendingFixture = [
      makeApproval({ id: "a1" /* no targetEntity */ }),
      makeApproval({ id: "a2", targetEntityId: "pkt-2" }),
    ];
    const map = await buildApprovalLookupFresh();
    expect(map.size).toBe(1);
    expect(map.get("pkt-2")?.id).toBe("a2");
  });

  it("pending wins over terminal-state listByAgent on conflict", async () => {
    pendingFixture = [
      makeApproval({ id: "pending-1", targetEntityId: "pkt-x", status: "pending" }),
    ];
    byAgentFixture = [
      makeApproval({ id: "old-1", targetEntityId: "pkt-x", status: "rejected" }),
      makeApproval({ id: "old-2", targetEntityId: "pkt-y", status: "approved" }),
    ];
    const map = await buildApprovalLookupFresh();
    // pkt-x must reflect the pending row, not the older rejected row.
    expect(map.get("pkt-x")).toEqual({ id: "pending-1", status: "pending" });
    // pkt-y wasn't pending, so the listByAgent row populates it.
    expect(map.get("pkt-y")).toEqual({ id: "old-2", status: "approved" });
  });

  it("listPending throws → still returns listByAgent rows (fail-soft)", async () => {
    pendingShouldThrow = true;
    byAgentFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-y", status: "approved" }),
    ];
    const map = await buildApprovalLookupFresh();
    expect(map.size).toBe(1);
    expect(map.get("pkt-y")?.id).toBe("a1");
  });

  it("listByAgent throws → still returns listPending rows (fail-soft)", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-z", status: "pending" }),
    ];
    byAgentShouldThrow = true;
    const map = await buildApprovalLookupFresh();
    expect(map.size).toBe(1);
    expect(map.get("pkt-z")?.id).toBe("a1");
  });

  it("both reads throw → empty map (fail-soft, no throw)", async () => {
    pendingShouldThrow = true;
    byAgentShouldThrow = true;
    const map = await buildApprovalLookupFresh();
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getCachedApprovalLookup — the production entry point
// ---------------------------------------------------------------------------

describe("getCachedApprovalLookup", () => {
  it("cache miss → fresh build → KV.set with ex:30 → returns fresh map", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    const map = await getCachedApprovalLookup();
    expect(map.get("pkt-1")?.id).toBe("a1");
    // Builder ran exactly once.
    expect(listPendingCalls).toBe(1);
    expect(listByAgentCalls).toBe(1);
    // KV.set was called with the TTL.
    expect(lastKvSetCall).not.toBeNull();
    expect(lastKvSetCall!.key).toBe("approval-lookup:receipt-review:v1");
    expect((lastKvSetCall!.opts as { ex: number }).ex).toBe(30);
  });

  it("cache hit (within TTL) → returns cached without rebuilding", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    // Prime the cache.
    await getCachedApprovalLookup();
    expect(listPendingCalls).toBe(1);
    // Mutate the fixture so "rebuilt" results would differ from "cached" results.
    pendingFixture = [
      makeApproval({ id: "OTHER", targetEntityId: "pkt-OTHER", status: "pending" }),
    ];
    const map = await getCachedApprovalLookup();
    // Builder did NOT run a second time (still 1 call).
    expect(listPendingCalls).toBe(1);
    expect(listByAgentCalls).toBe(1);
    // Cached value returned (the original a1, not the OTHER fixture).
    expect(map.get("pkt-1")?.id).toBe("a1");
    expect(map.get("pkt-OTHER")).toBeUndefined();
  });

  it("KV.get throws → fresh build (and best-effort write attempted)", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    kvGetShouldThrow = true;
    const map = await getCachedApprovalLookup();
    expect(map.get("pkt-1")?.id).toBe("a1");
    expect(listPendingCalls).toBe(1);
    // Even though get threw, set should still have been attempted.
    expect(lastKvSetCall).not.toBeNull();
  });

  it("garbage cached value → falls through to fresh build", async () => {
    // Prime the cache with a malformed entry.
    kvBacking.set(
      "approval-lookup:receipt-review:v1",
      "not-a-cached-shape" as unknown,
    );
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    const map = await getCachedApprovalLookup();
    expect(listPendingCalls).toBe(1); // fresh build ran
    expect(map.get("pkt-1")?.id).toBe("a1");
  });

  it("cached entries field is not an object → fresh build", async () => {
    kvBacking.set("approval-lookup:receipt-review:v1", {
      cachedAt: Date.now(),
      entries: "not-an-object",
    });
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    const map = await getCachedApprovalLookup();
    expect(listPendingCalls).toBe(1);
    expect(map.get("pkt-1")?.id).toBe("a1");
  });

  it("stale cached value (older than TTL) → falls through to fresh build", async () => {
    kvBacking.set("approval-lookup:receipt-review:v1", {
      cachedAt: Date.now() - 60_000, // 60s old, > 30s TTL
      entries: { "pkt-stale": { id: "stale-id", status: "approved" } },
    });
    pendingFixture = [
      makeApproval({ id: "fresh-id", targetEntityId: "pkt-1", status: "pending" }),
    ];
    const map = await getCachedApprovalLookup();
    expect(listPendingCalls).toBe(1); // fresh build ran
    // The stale "pkt-stale" entry was NOT served.
    expect(map.has("pkt-stale")).toBe(false);
    expect(map.get("pkt-1")?.id).toBe("fresh-id");
  });

  it("future-dated cachedAt (clock skew → negative ageMs) → fresh build", async () => {
    kvBacking.set("approval-lookup:receipt-review:v1", {
      cachedAt: Date.now() + 10_000, // 10s in the future
      entries: { "pkt-future": { id: "future-id", status: "pending" } },
    });
    pendingFixture = [
      makeApproval({ id: "fresh-id", targetEntityId: "pkt-1", status: "pending" }),
    ];
    const map = await getCachedApprovalLookup();
    expect(listPendingCalls).toBe(1);
    expect(map.has("pkt-future")).toBe(false);
    expect(map.get("pkt-1")?.id).toBe("fresh-id");
  });

  it("KV.set throws → fresh result still returned (write error swallowed)", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    kvSetShouldThrow = true;
    // Should NOT throw.
    const map = await getCachedApprovalLookup();
    expect(map.get("pkt-1")?.id).toBe("a1");
  });

  it("cached map round-trips through serialize/deserialize correctly", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
      makeApproval({ id: "a2", targetEntityId: "pkt-2", status: "pending" }),
    ];
    const first = await getCachedApprovalLookup();
    // Don't mutate the fixture — second call hits cache, must deserialize back to same shape.
    const second = await getCachedApprovalLookup();
    expect(second.size).toBe(first.size);
    expect(second.get("pkt-1")).toEqual(first.get("pkt-1"));
    expect(second.get("pkt-2")).toEqual(first.get("pkt-2"));
    // Confirm builder ran exactly once.
    expect(listPendingCalls).toBe(1);
  });

  it("cached entry with malformed inner shape is skipped (per-entry defensive)", async () => {
    kvBacking.set("approval-lookup:receipt-review:v1", {
      cachedAt: Date.now(),
      entries: {
        "pkt-good": { id: "ok", status: "pending" },
        "pkt-bad-1": { id: 123, status: "pending" }, // id wrong type
        "pkt-bad-2": null,
        "pkt-bad-3": { id: "x" /* no status */ },
      },
    });
    const map = await getCachedApprovalLookup();
    // Cache was a valid shape so builder did NOT run.
    expect(listPendingCalls).toBe(0);
    expect(map.get("pkt-good")).toEqual({ id: "ok", status: "pending" });
    expect(map.has("pkt-bad-1")).toBe(false);
    expect(map.has("pkt-bad-2")).toBe(false);
    expect(map.has("pkt-bad-3")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// invalidateApprovalLookupCache
// ---------------------------------------------------------------------------

describe("invalidateApprovalLookupCache", () => {
  it("clears the cached key so the next call rebuilds", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    await getCachedApprovalLookup();
    expect(listPendingCalls).toBe(1);
    await invalidateApprovalLookupCache();
    pendingFixture = [
      makeApproval({ id: "a2", targetEntityId: "pkt-2", status: "pending" }),
    ];
    const map = await getCachedApprovalLookup();
    expect(listPendingCalls).toBe(2); // rebuilt
    expect(map.get("pkt-2")?.id).toBe("a2");
  });

  it("KV.del throws → swallowed (best-effort)", async () => {
    kvDelShouldThrow = true;
    // Should NOT throw.
    await expect(invalidateApprovalLookupCache()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 24 — getCachedApprovalLookupWithMeta (cache freshness)
// ---------------------------------------------------------------------------
//
// Variant of getCachedApprovalLookup that ALSO returns `cachedAt` so
// the dashboard can render an "as of Xs ago" / "fresh" freshness
// indicator. Locked rules:
//   - Cache miss / stale / garbage / future-dated cachedAt /
//     KV.get throw → cachedAt: null (freshly built).
//   - Cache hit (within TTL) → cachedAt: number from the cached
//     value's cachedAt field (NOT Date.now() — the original write time).
//   - Map content is bit-identical to the same call shape on
//     getCachedApprovalLookup() (the wrapper).
//   - cachedAt is NEVER fabricated as 0 / -1 / now on a fresh build —
//     it's `null` honestly.

describe("getCachedApprovalLookupWithMeta", () => {
  it("cache miss → { map, cachedAt: null } (fresh build)", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    const result = await getCachedApprovalLookupWithMeta();
    expect(result.map.get("pkt-1")?.id).toBe("a1");
    expect(result.cachedAt).toBeNull();
    // Builder ran exactly once.
    expect(listPendingCalls).toBe(1);
  });

  it("cache hit (within TTL) → { map, cachedAt: <cached value's cachedAt> }", async () => {
    const cachedTimestamp = Date.now() - 5_000; // 5s old
    kvBacking.set(__INTERNAL.CACHE_KEY, {
      cachedAt: cachedTimestamp,
      entries: { "pkt-cached": { id: "appr-cached", status: "pending" } },
    });

    const result = await getCachedApprovalLookupWithMeta();
    // Map served from cache.
    expect(result.map.get("pkt-cached")?.id).toBe("appr-cached");
    // Builder did NOT run — value came from cache.
    expect(listPendingCalls).toBe(0);
    // cachedAt is the ORIGINAL write timestamp, NOT Date.now().
    expect(result.cachedAt).toBe(cachedTimestamp);
  });

  it("KV.get throw → { map, cachedAt: null } (fresh build)", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    kvGetShouldThrow = true;
    const result = await getCachedApprovalLookupWithMeta();
    expect(result.map.get("pkt-1")?.id).toBe("a1");
    expect(result.cachedAt).toBeNull();
  });

  it("garbage cached value → { map, cachedAt: null } (fresh build)", async () => {
    kvBacking.set(__INTERNAL.CACHE_KEY, "not-a-cached-shape" as unknown);
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    const result = await getCachedApprovalLookupWithMeta();
    expect(result.cachedAt).toBeNull();
    expect(result.map.get("pkt-1")?.id).toBe("a1");
  });

  it("stale cache (> TTL) → { map, cachedAt: null } (fresh build)", async () => {
    kvBacking.set(__INTERNAL.CACHE_KEY, {
      cachedAt: Date.now() - 60_000, // 60s old, > 30s TTL
      entries: { "pkt-stale": { id: "stale-id", status: "approved" } },
    });
    pendingFixture = [
      makeApproval({ id: "fresh-id", targetEntityId: "pkt-1", status: "pending" }),
    ];
    const result = await getCachedApprovalLookupWithMeta();
    expect(result.cachedAt).toBeNull();
    expect(result.map.has("pkt-stale")).toBe(false);
    expect(result.map.get("pkt-1")?.id).toBe("fresh-id");
  });

  it("future-dated cachedAt → { map, cachedAt: null } (fresh build, defensive)", async () => {
    kvBacking.set(__INTERNAL.CACHE_KEY, {
      cachedAt: Date.now() + 10_000, // 10s in the future
      entries: { "pkt-future": { id: "future-id", status: "pending" } },
    });
    pendingFixture = [
      makeApproval({ id: "fresh-id", targetEntityId: "pkt-1", status: "pending" }),
    ];
    const result = await getCachedApprovalLookupWithMeta();
    expect(result.cachedAt).toBeNull();
    expect(result.map.has("pkt-future")).toBe(false);
  });

  it("KV.set throw on fresh build → { map, cachedAt: null } (write error swallowed)", async () => {
    pendingFixture = [
      makeApproval({ id: "a1", targetEntityId: "pkt-1", status: "pending" }),
    ];
    kvSetShouldThrow = true;
    const result = await getCachedApprovalLookupWithMeta();
    expect(result.map.get("pkt-1")?.id).toBe("a1");
    expect(result.cachedAt).toBeNull();
  });

  it("getCachedApprovalLookup() is a thin wrapper — same map content on cache hit", async () => {
    const cachedTimestamp = Date.now() - 1_000;
    kvBacking.set(__INTERNAL.CACHE_KEY, {
      cachedAt: cachedTimestamp,
      entries: { "pkt-x": { id: "appr-x", status: "approved" } },
    });

    const meta = await getCachedApprovalLookupWithMeta();
    const plain = await getCachedApprovalLookup();
    // Same map content from both entry points.
    expect(plain.get("pkt-x")).toEqual(meta.map.get("pkt-x"));
    expect(plain.size).toBe(meta.map.size);
  });

  it("cachedAt is the cached value's timestamp, NOT Date.now() (defensive)", async () => {
    // Pin the cached value 20s in the past.
    const writeTime = Date.now() - 20_000;
    kvBacking.set(__INTERNAL.CACHE_KEY, {
      cachedAt: writeTime,
      entries: {},
    });
    const before = Date.now();
    const result = await getCachedApprovalLookupWithMeta();
    const after = Date.now();
    expect(result.cachedAt).toBe(writeTime);
    // Asserting the test doesn't fabricate now() as the cachedAt:
    expect(result.cachedAt).toBeLessThan(before);
    void after;
  });
});

// ---------------------------------------------------------------------------
// Static-source assertion — no forbidden imports / call sites
// ---------------------------------------------------------------------------

describe("read-only contract — no forbidden imports", () => {
  it("the module imports nothing from QBO writes, HubSpot, Shopify writes, Slack send, openApproval / buildApprovalRequest", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../receipt-review-approval-lookup.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*qbo-client/);
    expect(src).not.toMatch(/from\s+["'].*qbo-auth/);
    expect(src).not.toMatch(/from\s+["'].*hubspot/);
    expect(src).not.toMatch(/from\s+["'].*shopify-/);
    expect(src).not.toMatch(/from\s+["'].*slack-(send|client)/);
    expect(src).not.toMatch(/createQBOBill|createQBOInvoice|createQBOJournalEntry/);
    expect(src).not.toMatch(/chat\.postMessage|chat\.update|WebClient/);
    expect(src).not.toMatch(/import[^;]*\bopenApproval\b/);
    expect(src).not.toMatch(/import[^;]*\bbuildApprovalRequest\b/);
    expect(src).not.toMatch(/\bopenApproval\s*\(/);
    expect(src).not.toMatch(/\bbuildApprovalRequest\s*\(/);
    // Module exports are limited to the canonical surface.
    expect(src).toMatch(/export\s+async\s+function\s+buildApprovalLookupFresh/);
    expect(src).toMatch(/export\s+async\s+function\s+getCachedApprovalLookup\s*\(/);
    expect(src).toMatch(/export\s+async\s+function\s+getCachedApprovalLookupWithMeta/);
    expect(src).toMatch(/export\s+async\s+function\s+invalidateApprovalLookupCache/);
  });
});
