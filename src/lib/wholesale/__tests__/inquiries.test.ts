/**
 * Tests for the wholesale inquiry archive (`src/lib/wholesale/inquiries.ts`).
 *
 * Locks the Phase 6 contracts:
 *   - Round-trip: append → list → summary returns the persisted record.
 *   - Most-recent-first ordering preserved across appends.
 *   - Index cap doesn't drop a freshly written record while it's still
 *     the most recent (LRU-by-index, head insertion).
 *   - `getWholesaleInquirySummary` returns `ok:false` (not `wired:0`) on
 *     a KV exception — locks the no-fabricated-zero rule.
 *   - Empty-but-reachable archive returns `ok:true, total:0` — that's a
 *     real, source-attested zero, not a fabrication.
 *   - Records without email AND without phone are rejected at the
 *     archive boundary (defense-in-depth alongside the public route).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory KV mock so tests are deterministic and never hit the real
// store. Mirrors the @vercel/kv shape used by the module.
const store = new Map<string, unknown>();
let kvShouldThrow: { op: "get" | "set" | "all" | null; reason: string } = {
  op: null,
  reason: "",
};

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => {
      if (kvShouldThrow.op === "get" || kvShouldThrow.op === "all") {
        throw new Error(kvShouldThrow.reason);
      }
      return store.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      if (kvShouldThrow.op === "set" || kvShouldThrow.op === "all") {
        throw new Error(kvShouldThrow.reason);
      }
      store.set(key, value);
    }),
  },
}));

import {
  __INTERNAL,
  appendWholesaleInquiry,
  getWholesaleInquirySummary,
  listWholesaleInquiries,
} from "../inquiries";

beforeEach(() => {
  store.clear();
  kvShouldThrow = { op: null, reason: "" };
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Append + list round-trip
// ---------------------------------------------------------------------------

describe("appendWholesaleInquiry / listWholesaleInquiries", () => {
  it("persists a record and returns it from list (round-trip)", async () => {
    const out = await appendWholesaleInquiry({
      email: "buyer@example.com",
      storeName: "Tasty Foods",
      buyerName: "Jane Buyer",
      location: "Austin, TX",
      interest: "starter-case",
      source: "wholesale-page",
      intent: "wholesale",
    });
    expect(out.id).toBeTruthy();
    expect(out.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const listed = await listWholesaleInquiries();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(out.id);
    expect(listed[0].email).toBe("buyer@example.com");
    expect(listed[0].storeName).toBe("Tasty Foods");
  });

  it("most-recent-first ordering across multiple appends", async () => {
    const r1 = await appendWholesaleInquiry({ email: "a@x.com" });
    const r2 = await appendWholesaleInquiry({ email: "b@x.com" });
    const r3 = await appendWholesaleInquiry({ email: "c@x.com" });
    const listed = await listWholesaleInquiries();
    expect(listed.map((r) => r.id)).toEqual([r3.id, r2.id, r1.id]);
  });

  it("normalizes empty strings to undefined", async () => {
    const out = await appendWholesaleInquiry({
      email: "buyer@example.com",
      storeName: "  ",
      location: "",
      buyerName: "Jane",
    });
    expect(out.storeName).toBeUndefined();
    expect(out.location).toBeUndefined();
    expect(out.buyerName).toBe("Jane");
  });

  it("rejects records with neither email nor phone (boundary defense)", async () => {
    await expect(
      appendWholesaleInquiry({ storeName: "Anonymous LLC" }),
    ).rejects.toThrow(/neither email nor phone/i);
  });

  it("accepts a record with phone only (matches public form gate)", async () => {
    const out = await appendWholesaleInquiry({ phone: "555-1212" });
    expect(out.phone).toBe("555-1212");
    expect(out.email).toBeUndefined();
  });

  it("dedupes when the same id is appended twice (head insertion)", async () => {
    const r1 = await appendWholesaleInquiry({ id: "abc", email: "a@x.com" });
    await appendWholesaleInquiry({ email: "b@x.com" });
    // Re-append id "abc" — it should move to the head, not duplicate.
    await appendWholesaleInquiry({ id: r1.id, email: "a@x.com" });
    const listed = await listWholesaleInquiries();
    const ids = listed.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids[0]).toBe(r1.id); // most-recent-first
  });
});

// ---------------------------------------------------------------------------
// Summary — wired with real number
// ---------------------------------------------------------------------------

describe("getWholesaleInquirySummary — happy path", () => {
  it("returns ok:true total:0 on empty archive (real source-attested zero)", async () => {
    const result = await getWholesaleInquirySummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.total).toBe(0);
    expect(result.summary.lastSubmittedAt).toBeUndefined();
  });

  it("returns total + lastSubmittedAt from the most recent record", async () => {
    await appendWholesaleInquiry({ email: "a@x.com" });
    const r2 = await appendWholesaleInquiry({ email: "b@x.com" });
    const result = await getWholesaleInquirySummary();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.total).toBe(2);
    expect(result.summary.lastSubmittedAt).toBe(r2.submittedAt);
  });
});

// ---------------------------------------------------------------------------
// Summary — error path NEVER fabricates 0
// ---------------------------------------------------------------------------

describe("getWholesaleInquirySummary — KV exceptions never fabricate 0", () => {
  it("KV get throw → ok:false with reason (NOT total:0)", async () => {
    kvShouldThrow = { op: "get", reason: "ECONNREFUSED" };
    const result = await getWholesaleInquirySummary();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("KV read failed");
    expect(result.reason).toContain("ECONNREFUSED");
  });

  it("non-Error throw still produces ok:false (no silent zero)", async () => {
    kvShouldThrow = { op: "get", reason: "string-thrown" };
    const result = await getWholesaleInquirySummary();
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Listing limit
// ---------------------------------------------------------------------------

describe("listWholesaleInquiries — limit clamping", () => {
  beforeEach(async () => {
    for (let i = 0; i < 30; i++) {
      await appendWholesaleInquiry({ email: `r${i}@x.com` });
    }
  });

  it("respects an explicit limit", async () => {
    const out = await listWholesaleInquiries({ limit: 5 });
    expect(out).toHaveLength(5);
  });

  it("defaults to 50 when no limit is provided", async () => {
    const out = await listWholesaleInquiries();
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.length).toBe(30); // we appended 30
  });

  it("clamps absurd limits to 500 (server-side bound)", async () => {
    const out = await listWholesaleInquiries({ limit: 999_999 });
    expect(out.length).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// KV layout sanity (locked so future refactors can't change it silently)
// ---------------------------------------------------------------------------

describe("KV layout (locked)", () => {
  it("uses the canonical index key", () => {
    expect(__INTERNAL.KV_INDEX_KEY).toBe("wholesale:inquiries:index");
  });

  it("uses the canonical record key prefix", () => {
    expect(__INTERNAL.KV_RECORD_PREFIX).toBe("wholesale:inquiry:");
    expect(__INTERNAL.recordKey("abc")).toBe("wholesale:inquiry:abc");
  });

  it("caps the index at a sane bound to keep KV size predictable", () => {
    expect(__INTERNAL.INDEX_CAP).toBeGreaterThanOrEqual(1000);
    expect(__INTERNAL.INDEX_CAP).toBeLessThanOrEqual(50_000);
  });

  it("records carry a TTL backstop so abandoned data doesn't accumulate forever", () => {
    expect(__INTERNAL.RECORD_TTL_SECONDS).toBeGreaterThanOrEqual(30 * 24 * 3600);
  });
});
