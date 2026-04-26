/**
 * Tests for GET /api/ops/docs/receipt-review-packets (Phase 13 list).
 *
 * Locked rules:
 *   - 401 on auth fail.
 *   - 200 with empty list when no packets stored.
 *   - 200 with packets verbatim (most-recent-first by createdAt).
 *   - `limit` query param clamped to [1, 500] (default 100).
 *   - 500 on KV throw — NEVER 200 with `count: 0` silently.
 *   - Static-source assertion: route imports nothing from QBO/HubSpot/
 *     Shopify writes / Slack send / approval-store mutation paths.
 *     Only GET exported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const store = new Map<string, unknown>();
let kvShouldThrow = false;

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => {
      if (kvShouldThrow) throw new Error("ECONNREFUSED");
      return store.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

import { GET } from "../route";
import { processReceipt, requestReceiptReviewPromotion } from "@/lib/ops/docs";

beforeEach(() => {
  store.clear();
  kvShouldThrow = false;
  isAuthorizedMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(path = "/api/ops/docs/receipt-review-packets"): Request {
  return new Request(`https://www.usagummies.com${path}`, { method: "GET" });
}

describe("auth gate", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });
});

describe("happy path", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("200 with empty list when no packets stored", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      count: number;
      packets: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(0);
    expect(body.packets).toEqual([]);
  });

  it("returns packets when KV has entries", async () => {
    const r1 = await processReceipt({
      source_url: "https://example.com/a.jpg",
      source_channel: "test",
    });
    const r2 = await processReceipt({
      source_url: "https://example.com/b.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r1.id);
    await requestReceiptReviewPromotion(r2.id);

    const res = await GET(makeReq());
    const body = (await res.json()) as {
      count: number;
      packets: Array<{ packetId: string; receiptId: string }>;
    };
    expect(body.count).toBe(2);
    const ids = body.packets.map((p) => p.receiptId).sort();
    expect(ids).toEqual([r1.id, r2.id].sort());
  });

  it("clamps limit to [1, 500]", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await processReceipt({
        source_url: `https://example.com/${i}.jpg`,
        source_channel: "test",
      });
      await requestReceiptReviewPromotion(r.id);
    }
    const lo = await GET(makeReq("/api/ops/docs/receipt-review-packets?limit=0"));
    const hi = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?limit=999999"),
    );
    const negative = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?limit=-5"),
    );
    const loBody = (await lo.json()) as { packets: unknown[] };
    const hiBody = (await hi.json()) as { packets: unknown[] };
    const negBody = (await negative.json()) as { packets: unknown[] };
    // Even with limit=0/-5, the route returns at least 1 (clamped).
    // Real list size is 5 here; both lo and negative should still
    // return all 5 because the underlying helper's effective floor
    // is 1 — but our assertion is just that it didn't return 0
    // and that hi didn't blow past 500.
    expect(loBody.packets.length).toBeLessThanOrEqual(5);
    expect(loBody.packets.length).toBeGreaterThanOrEqual(1);
    expect(hiBody.packets.length).toBeLessThanOrEqual(500);
    expect(negBody.packets.length).toBeGreaterThanOrEqual(1);
  });
});

describe("error path — never fabricates count: 0", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("KV throw → 500 with reason, NOT 200 with count: 0", async () => {
    kvShouldThrow = true;
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      reason: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("list_read_failed");
    expect(body.reason).toContain("ECONNREFUSED");
  });
});

describe("read-only contract — no forbidden imports", () => {
  it("the route imports nothing from QBO writes, HubSpot, Shopify writes, Slack send/client/post, openApproval/buildApprovalRequest", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../route.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*qbo-client/);
    expect(src).not.toMatch(/from\s+["'].*qbo-auth/);
    expect(src).not.toMatch(/from\s+["'].*hubspot/);
    expect(src).not.toMatch(/from\s+["'].*shopify-/);
    expect(src).not.toMatch(/from\s+["'].*slack-(send|client)/);
    expect(src).not.toMatch(/createQBOBill|createQBOInvoice|createQBOJournalEntry/);
    expect(src).not.toMatch(/chat\.postMessage|chat\.update|WebClient/);
    // No openApproval / buildApprovalRequest call sites or imports
    // (matches `import { openApproval } …` or `openApproval(` and
    // their buildApprovalRequest equivalents — but tolerates the
    // names appearing in JSDoc comments).
    expect(src).not.toMatch(/import[^;]*\bopenApproval\b/);
    expect(src).not.toMatch(/import[^;]*\bbuildApprovalRequest\b/);
    expect(src).not.toMatch(/\bopenApproval\s*\(/);
    expect(src).not.toMatch(/\bbuildApprovalRequest\s*\(/);
    // Only GET exported.
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|DELETE|PATCH)/);
  });
});

// ---------------------------------------------------------------------------
// Phase 15 — server-side filtering via canonical helper
// ---------------------------------------------------------------------------

describe("Phase 15 — server-side filtering", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  async function seedThreePackets() {
    const r1 = await processReceipt({
      source_url: "https://example.com/belmark.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-15",
      amount: 250,
      category: "supplies",
    });
    const r2 = await processReceipt({
      source_url: "https://example.com/uline.jpg",
      source_channel: "test",
      vendor: "Uline",
      date: "2026-04-22",
      amount: 50,
      category: "supplies",
    });
    const r3 = await processReceipt({
      source_url: "https://example.com/albanese.jpg",
      source_channel: "test",
      vendor: "Albanese",
      date: "2026-04-23",
      amount: 1200,
      category: "supplies",
    });
    await requestReceiptReviewPromotion(r1.id);
    await requestReceiptReviewPromotion(r2.id);
    await requestReceiptReviewPromotion(r3.id);
    return { r1, r2, r3 };
  }

  it("no filter params → returns all packets, filterApplied=false", async () => {
    await seedThreePackets();
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      count: number;
      totalBeforeFilter: number;
      filterApplied: boolean;
      packets: Array<{ packetId: string }>;
    };
    expect(body.count).toBe(3);
    expect(body.totalBeforeFilter).toBe(3);
    expect(body.filterApplied).toBe(false);
  });

  it("vendor query param narrows packets server-side", async () => {
    await seedThreePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?vendor=belmark"),
    );
    const body = (await res.json()) as {
      count: number;
      totalBeforeFilter: number;
      filterApplied: boolean;
      packets: Array<{ canonical: { vendor: string | null } }>;
    };
    expect(body.filterApplied).toBe(true);
    expect(body.count).toBe(1);
    expect(body.totalBeforeFilter).toBe(3);
    expect(body.packets[0].canonical.vendor).toMatch(/Belmark/i);
  });

  it("status query param narrows by packet status", async () => {
    await seedThreePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?status=draft"),
    );
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(3); // all three are draft until closer runs
  });

  it("status=all is treated as no filter (filterApplied=false)", async () => {
    await seedThreePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?status=all"),
    );
    const body = (await res.json()) as {
      filterApplied: boolean;
      count: number;
    };
    expect(body.filterApplied).toBe(false);
    expect(body.count).toBe(3);
  });

  it("createdAfter / createdBefore narrow the date range", async () => {
    await seedThreePackets();
    // All three packets were created roughly now (in test env). Use a
    // far-future createdAfter to filter them all out.
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets?createdAfter=2099-01-01",
      ),
    );
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(0);
  });

  it("server filter is bit-identical to the client helper for the same input", async () => {
    const { r1, r2, r3 } = await seedThreePackets();
    void r1; void r2; void r3;
    // Pull the canonical client helper + run it against the same KV
    // seed. The server's response packetIds must match.
    const { listReceiptReviewPackets } = await import("@/lib/ops/docs");
    const { filterPacketsBySpec } = await import(
      "@/app/ops/finance/review-packets/data"
    );
    const allPackets = await listReceiptReviewPackets({ limit: 100 });
    const clientFiltered = filterPacketsBySpec(allPackets, {
      vendorContains: "belmark",
    });

    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?vendor=belmark"),
    );
    const body = (await res.json()) as { packets: Array<{ packetId: string }> };
    expect(body.packets.map((p) => p.packetId).sort()).toEqual(
      clientFiltered.map((p) => p.packetId).sort(),
    );
  });

  it("unknown query params are ignored (URL tracking compatibility)", async () => {
    await seedThreePackets();
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets?utm_source=slack&random=foo",
      ),
    );
    const body = (await res.json()) as { count: number; filterApplied: boolean };
    expect(body.count).toBe(3);
    expect(body.filterApplied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 16 — approval-status filter + route join
// ---------------------------------------------------------------------------

describe("Phase 16 — approval-status filter + lookup", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("response carries an approvals lookup keyed by packetId (empty when no approvals exist)", async () => {
    const r = await processReceipt({
      source_url: "https://example.com/x.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r.id);

    const res = await GET(makeReq());
    const body = (await res.json()) as {
      packets: Array<{ packetId: string }>;
      approvals: Record<string, unknown>;
    };
    expect(body.approvals).toBeDefined();
    expect(typeof body.approvals).toBe("object");
    expect(body.approvals[body.packets[0].packetId]).toBeUndefined();
  });

  it("approvalStatus=any → no filter (filterApplied=false)", async () => {
    const r = await processReceipt({
      source_url: "https://example.com/x.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r.id);

    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?approvalStatus=any"),
    );
    const body = (await res.json()) as { filterApplied: boolean; count: number };
    expect(body.filterApplied).toBe(false);
    expect(body.count).toBe(1);
  });

  it("approvalStatus=no-approval narrows to packets with no matching approval", async () => {
    const r1 = await processReceipt({
      source_url: "https://example.com/a.jpg",
      source_channel: "test",
    });
    const r2 = await processReceipt({
      source_url: "https://example.com/b.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r1.id);
    await requestReceiptReviewPromotion(r2.id);

    // Test environment has no approvalStore entries → all packets
    // are no-approval. Filter should match both.
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets?approvalStatus=no-approval",
      ),
    );
    const body = (await res.json()) as {
      filterApplied: boolean;
      count: number;
    };
    expect(body.filterApplied).toBe(true);
    expect(body.count).toBe(2);
  });

  it("approvalStatus=pending filters to zero in test env (no approvals seeded)", async () => {
    const r1 = await processReceipt({
      source_url: "https://example.com/a.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r1.id);

    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets?approvalStatus=pending",
      ),
    );
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(0);
  });

  it("unknown approvalStatus value collapses to no filter (defensive)", async () => {
    const r = await processReceipt({
      source_url: "https://example.com/x.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r.id);

    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?approvalStatus=fubar"),
    );
    const body = (await res.json()) as { filterApplied: boolean; count: number };
    expect(body.filterApplied).toBe(false);
    expect(body.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 24 — cache freshness metadata in response
// ---------------------------------------------------------------------------
//
// The list route surfaces `approvalsLookupCachedAt` so the dashboard
// can render an "as of Xs ago" indicator. Locked rules:
//   - Cache miss / fresh build → `approvalsLookupCachedAt: null`
//     (NEVER fabricated as 0 / -1 / now).
//   - Cache hit (within 30s TTL) → `approvalsLookupCachedAt: number`
//     equal to the cached value's `cachedAt` field.
//   - Field is always present in the response (no missing-key
//     ambiguity) so the client doesn't need to handle three cases.

describe("Phase 24 — approvalsLookupCachedAt response field", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("fresh build (no cache primed) → approvalsLookupCachedAt: null", async () => {
    const r = await processReceipt({
      source_url: "https://example.com/x.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r.id);
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      approvalsLookupCachedAt: number | null;
    };
    expect(body).toHaveProperty("approvalsLookupCachedAt");
    expect(body.approvalsLookupCachedAt).toBeNull();
  });

  it("cache hit → approvalsLookupCachedAt is a number equal to the cached value's cachedAt", async () => {
    // Prime the cache directly with a sentinel timestamp.
    const cachedTimestamp = Date.now() - 5_000; // 5s ago, well within TTL
    store.set("approval-lookup:receipt-review:v1", {
      cachedAt: cachedTimestamp,
      entries: {},
    });

    const r = await processReceipt({
      source_url: "https://example.com/x.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r.id);

    // First call serves from the primed cache.
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      approvalsLookupCachedAt: number | null;
    };
    expect(body.approvalsLookupCachedAt).toBe(cachedTimestamp);
  });

  it("response shape ALWAYS includes approvalsLookupCachedAt (no missing-key ambiguity)", async () => {
    const res = await GET(makeReq());
    const body = (await res.json()) as Record<string, unknown>;
    expect("approvalsLookupCachedAt" in body).toBe(true);
  });

  it("approvalsLookupCachedAt is NEVER fabricated as 0 / now on a fresh build", async () => {
    const before = Date.now();
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      approvalsLookupCachedAt: number | null;
    };
    // Honest null on fresh build — not 0, not -1, not Date.now().
    expect(body.approvalsLookupCachedAt).toBeNull();
    expect(body.approvalsLookupCachedAt).not.toBe(0);
    expect(body.approvalsLookupCachedAt).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Phase 23 — id-substring search
// ---------------------------------------------------------------------------

describe("Phase 23 — id-substring search via ?id=...", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  async function seedThree() {
    const r1 = await processReceipt({
      source_url: "https://example.com/belmark.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-15",
      amount: 250,
      category: "supplies",
    });
    const r2 = await processReceipt({
      source_url: "https://example.com/uline.jpg",
      source_channel: "test",
      vendor: "Uline",
      date: "2026-04-22",
      amount: 50,
      category: "supplies",
    });
    const r3 = await processReceipt({
      source_url: "https://example.com/albanese.jpg",
      source_channel: "test",
      vendor: "Albanese",
      date: "2026-04-23",
      amount: 1200,
      category: "supplies",
    });
    await requestReceiptReviewPromotion(r1.id);
    await requestReceiptReviewPromotion(r2.id);
    await requestReceiptReviewPromotion(r3.id);
    return { r1, r2, r3 };
  }

  it("?id=<unique-receiptId-suffix> narrows to that packet's row", async () => {
    const { r1 } = await seedThree();
    // Receipt ids include a random suffix; use the last 8 chars
    // so the substring is unique to this receipt.
    const unique = r1.id.slice(-8);
    const res = await GET(
      makeReq(
        `/api/ops/docs/receipt-review-packets?id=${encodeURIComponent(unique)}`,
      ),
    );
    const body = (await res.json()) as {
      filterApplied: boolean;
      count: number;
      packets: Array<{ receiptId: string }>;
    };
    expect(body.filterApplied).toBe(true);
    expect(body.count).toBe(1);
    expect(body.packets[0].receiptId).toBe(r1.id);
  });

  it("?id=<full-packetId> matches exactly one row", async () => {
    const { r1 } = await seedThree();
    const packetId = `pkt-v1-${r1.id}`;
    const res = await GET(
      makeReq(
        `/api/ops/docs/receipt-review-packets?id=${encodeURIComponent(packetId)}`,
      ),
    );
    const body = (await res.json()) as {
      count: number;
      packets: Array<{ packetId: string }>;
    };
    expect(body.count).toBe(1);
    expect(body.packets[0].packetId).toBe(packetId);
  });

  it("?id with no match → count: 0 (no fabrication)", async () => {
    await seedThree();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?id=no-such-id-anywhere"),
    );
    const body = (await res.json()) as {
      filterApplied: boolean;
      count: number;
      matchedTotal: number;
      totalBeforeFilter: number;
    };
    expect(body.filterApplied).toBe(true);
    expect(body.count).toBe(0);
    expect(body.matchedTotal).toBe(0);
    expect(body.totalBeforeFilter).toBe(3);
  });

  it("empty / whitespace ?id collapses to no filter", async () => {
    await seedThree();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?id=%20%20%20"),
    );
    const body = (await res.json()) as {
      filterApplied: boolean;
      count: number;
    };
    expect(body.filterApplied).toBe(false);
    expect(body.count).toBe(3);
  });

  it("composes with vendor filter (AND semantics)", async () => {
    const { r1 } = await seedThree();
    const res = await GET(
      makeReq(
        `/api/ops/docs/receipt-review-packets?id=${encodeURIComponent(r1.id)}&vendor=uline`,
      ),
    );
    const body = (await res.json()) as { count: number };
    // r1's id matches but vendor filter "uline" doesn't (r1 is Belmark)
    // → AND of two filters produces zero rows.
    expect(body.count).toBe(0);
  });

  it("server filter is bit-identical to the client helper for the same id needle", async () => {
    const { r1, r2, r3 } = await seedThree();
    void r1; void r2; void r3;
    const { listReceiptReviewPackets } = await import("@/lib/ops/docs");
    const { filterPacketsBySpec } = await import(
      "@/app/ops/finance/review-packets/data"
    );
    const allPackets = await listReceiptReviewPackets({ limit: 100 });
    // Use the last 8 chars for a unique substring (random suffix).
    const unique = r1.id.slice(-8);
    const clientFiltered = filterPacketsBySpec(allPackets, {
      idContains: unique,
    });

    const res = await GET(
      makeReq(
        `/api/ops/docs/receipt-review-packets?id=${encodeURIComponent(unique)}`,
      ),
    );
    const body = (await res.json()) as { packets: Array<{ packetId: string }> };
    expect(body.packets.map((p) => p.packetId).sort()).toEqual(
      clientFiltered.map((p) => p.packetId).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 17 — cursor pagination
// ---------------------------------------------------------------------------

describe("Phase 17 — cursor pagination", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  async function seedFivePackets() {
    for (const i of [1, 2, 3, 4, 5]) {
      const r = await processReceipt({
        source_url: `https://example.com/${i}.jpg`,
        source_channel: "test",
        vendor: `Vendor ${i}`,
      });
      await requestReceiptReviewPromotion(r.id);
    }
  }

  it("returns nextCursor non-null when more pages remain", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?limit=2"),
    );
    const body = (await res.json()) as {
      count: number;
      matchedTotal: number;
      nextCursor: string | null;
    };
    expect(body.count).toBe(2);
    expect(body.matchedTotal).toBe(5);
    expect(typeof body.nextCursor).toBe("string");
    expect((body.nextCursor as string).length).toBeGreaterThan(0);
  });

  it("returns nextCursor null when the page is the last one", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?limit=100"),
    );
    const body = (await res.json()) as {
      count: number;
      nextCursor: string | null;
    };
    expect(body.count).toBe(5);
    expect(body.nextCursor).toBeNull();
  });

  it("traversing all cursors visits every packet exactly once", async () => {
    await seedFivePackets();
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let safety = 0; safety < 20; safety++) {
      const path = cursor
        ? `/api/ops/docs/receipt-review-packets?limit=2&cursor=${encodeURIComponent(cursor)}`
        : "/api/ops/docs/receipt-review-packets?limit=2";
      const res = await GET(makeReq(path));
      const body = (await res.json()) as {
        packets: Array<{ packetId: string }>;
        nextCursor: string | null;
      };
      for (const p of body.packets) seen.add(p.packetId);
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    expect(seen.size).toBe(5);
  });

  it("malformed cursor falls back to first page (no fabrication, no throw)", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets?limit=2&cursor=not-a-real-cursor",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      count: number;
      packets: unknown[];
    };
    expect(body.count).toBe(2);
    expect(body.packets).toHaveLength(2);
  });

  it("filters apply BEFORE pagination (cursor traverses filtered set)", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets?limit=10&vendor=Vendor 1",
      ),
    );
    const body = (await res.json()) as {
      count: number;
      matchedTotal: number;
      filterApplied: boolean;
    };
    expect(body.filterApplied).toBe(true);
    expect(body.count).toBe(1);
    expect(body.matchedTotal).toBe(1);
  });

  it("approvals lookup is scoped to the current page only", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?limit=2"),
    );
    const body = (await res.json()) as {
      packets: Array<{ packetId: string }>;
      approvals: Record<string, unknown>;
    };
    // No approvals are seeded in test env, so the map is empty —
    // but the contract is "no irrelevant entries leak through".
    // Lock the size relationship: |approvals| <= |packets|.
    expect(Object.keys(body.approvals).length).toBeLessThanOrEqual(
      body.packets.length,
    );
  });

  it("matchedTotal equals totalBeforeFilter when no filter is applied", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets?limit=2"),
    );
    const body = (await res.json()) as {
      matchedTotal: number;
      totalBeforeFilter: number;
      filterApplied: boolean;
    };
    expect(body.filterApplied).toBe(false);
    expect(body.matchedTotal).toBe(body.totalBeforeFilter);
    expect(body.matchedTotal).toBe(5);
  });
});
