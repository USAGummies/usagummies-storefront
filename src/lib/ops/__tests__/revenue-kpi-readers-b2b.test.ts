/**
 * Phase 5 — B2B revenue reader contract tests.
 *
 * Locks the safe-source rules from the Phase 5 audit:
 *   - Reader uses ONLY paid Shopify orders carrying `tag:wholesale`.
 *   - Drafts and on-hold invoice-me orders never count (filter is
 *     `financial_status:paid`, enforced by the upstream Shopify
 *     query helper that this test mocks).
 *   - QBO and HubSpot helpers are NEVER imported or called — proven
 *     by mocking `queryPaidOrdersForBurnRate` to be the only data
 *     dependency.
 *   - Shopify-DTC channel and B2B channel are disjoint: same paid
 *     orders cannot land in both. Locked here by asserting the tag
 *     filter passed in each call.
 *   - Missing token → not_wired, NEVER 0.
 *   - Errors → error with reason, NEVER 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  B2B_SHOPIFY_TAG,
  readB2BLast7d,
  readShopifyLast7d,
} from "../revenue-kpi-readers";

// Mock the Shopify Admin helper. Every test sets `lastCallOpts` so
// we can assert on the tagFilter the reader passes.
let lastCallOpts: Array<Record<string, unknown>> = [];
const mockQuery = vi.fn(async (opts: Record<string, unknown>) => {
  lastCallOpts.push(opts);
  return [] as Array<{
    id: string;
    name: string;
    createdAt: string;
    totalUnits: number;
    totalAmount: number;
  }>;
});

vi.mock("@/lib/ops/shopify-admin-actions", () => ({
  queryPaidOrdersForBurnRate: (opts: Record<string, unknown>) => mockQuery(opts),
}));

const NOW = new Date("2026-04-25T12:00:00Z");

beforeEach(() => {
  lastCallOpts = [];
  mockQuery.mockClear();
});

afterEach(() => {
  delete process.env.SHOPIFY_ADMIN_API_TOKEN;
});

// ---------------------------------------------------------------------------
// not_wired path
// ---------------------------------------------------------------------------

describe("readB2BLast7d — token gating", () => {
  it("returns not_wired with reason when SHOPIFY_ADMIN_API_TOKEN is unset", async () => {
    delete process.env.SHOPIFY_ADMIN_API_TOKEN;
    const r = await readB2BLast7d(NOW);
    expect(r.status).toBe("not_wired");
    expect(r.amountUsd).toBeNull();
    expect(r.reason).toMatch(/SHOPIFY_ADMIN_API_TOKEN/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns not_wired with reason when token is whitespace-only", async () => {
    process.env.SHOPIFY_ADMIN_API_TOKEN = "   ";
    const r = await readB2BLast7d(NOW);
    expect(r.status).toBe("not_wired");
    expect(r.amountUsd).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// wired path — sums correctly + passes the right filter
// ---------------------------------------------------------------------------

describe("readB2BLast7d — wired sum", () => {
  beforeEach(() => {
    process.env.SHOPIFY_ADMIN_API_TOKEN = "test-token";
  });

  it("passes tagFilter:{include:['wholesale']} to the query", async () => {
    await readB2BLast7d(NOW);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(lastCallOpts[0]).toMatchObject({
      days: 7,
      tagFilter: { include: [B2B_SHOPIFY_TAG] },
    });
  });

  it("sums totalAmount across paid wholesale-tagged orders", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "1",
        name: "#W1001",
        createdAt: new Date(NOW.getTime() - 24 * 3600_000).toISOString(),
        totalUnits: 6,
        totalAmount: 250.5,
      },
      {
        id: "2",
        name: "#W1002",
        createdAt: new Date(NOW.getTime() - 48 * 3600_000).toISOString(),
        totalUnits: 36,
        totalAmount: 1499.99,
      },
    ]);
    const r = await readB2BLast7d(NOW);
    expect(r.status).toBe("wired");
    expect(r.amountUsd).toBe(1750.49);
    expect(r.source?.system).toMatch(/tag:wholesale/);
    expect(r.source?.system).toMatch(/financial_status:paid/);
    expect(r.source?.retrievedAt).toBe(NOW.toISOString());
  });

  it("returns wired:0 (not null) when no wholesale orders matched in window", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const r = await readB2BLast7d(NOW);
    expect(r.status).toBe("wired");
    expect(r.amountUsd).toBe(0);
  });

  it("filters orders older than 7 days even if Shopify returned them (defensive belt)", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "in",
        name: "#W1001",
        createdAt: new Date(NOW.getTime() - 6 * 24 * 3600_000).toISOString(),
        totalUnits: 6,
        totalAmount: 100,
      },
      {
        id: "out",
        name: "#W0500",
        createdAt: new Date(NOW.getTime() - 14 * 24 * 3600_000).toISOString(),
        totalUnits: 6,
        totalAmount: 999, // would inflate if not filtered
      },
    ]);
    const r = await readB2BLast7d(NOW);
    expect(r.amountUsd).toBe(100);
  });

  it("ignores NaN/Infinity amounts (no contamination)", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "good",
        name: "#W1",
        createdAt: NOW.toISOString(),
        totalUnits: 1,
        totalAmount: 200,
      },
      {
        id: "bad",
        name: "#W2",
        createdAt: NOW.toISOString(),
        totalUnits: 1,
        totalAmount: NaN,
      },
    ]);
    const r = await readB2BLast7d(NOW);
    expect(r.amountUsd).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// error path — never silently zero
// ---------------------------------------------------------------------------

describe("readB2BLast7d — error path", () => {
  beforeEach(() => {
    process.env.SHOPIFY_ADMIN_API_TOKEN = "test-token";
  });

  it("upstream throw → status='error' with the underlying message; amountUsd stays null (NOT 0)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("Shopify Admin GraphQL 502"));
    const r = await readB2BLast7d(NOW);
    expect(r.status).toBe("error");
    expect(r.amountUsd).toBeNull();
    expect(r.reason).toContain("Shopify Admin GraphQL 502");
  });

  it("non-Error throw still reports honestly (no fabricated 0)", async () => {
    mockQuery.mockRejectedValueOnce("string-thrown");
    const r = await readB2BLast7d(NOW);
    expect(r.status).toBe("error");
    expect(r.amountUsd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Disjoint contract — Shopify DTC excludes wholesale; B2B includes it
// ---------------------------------------------------------------------------

describe("Shopify DTC vs B2B — no double-count contract", () => {
  beforeEach(() => {
    process.env.SHOPIFY_ADMIN_API_TOKEN = "test-token";
  });

  it("Shopify reader passes tagFilter:{exclude:['wholesale']}", async () => {
    await readShopifyLast7d(NOW);
    expect(lastCallOpts[0]).toMatchObject({
      days: 7,
      tagFilter: { exclude: [B2B_SHOPIFY_TAG] },
    });
  });

  it("B2B reader passes tagFilter:{include:['wholesale']} — same tag, opposite direction", async () => {
    await readB2BLast7d(NOW);
    expect(lastCallOpts[0]).toMatchObject({
      days: 7,
      tagFilter: { include: [B2B_SHOPIFY_TAG] },
    });
  });

  it("the two filters use the SAME tag string (drift guard)", async () => {
    await readShopifyLast7d(NOW);
    await readB2BLast7d(NOW);
    const dtcCall = lastCallOpts[0] as {
      tagFilter: { exclude: string[] };
    };
    const b2bCall = lastCallOpts[1] as {
      tagFilter: { include: string[] };
    };
    expect(dtcCall.tagFilter.exclude[0]).toBe(b2bCall.tagFilter.include[0]);
    expect(dtcCall.tagFilter.exclude[0]).toBe(B2B_SHOPIFY_TAG);
  });
});

// ---------------------------------------------------------------------------
// Read-only — no QBO / HubSpot dependency
// ---------------------------------------------------------------------------

describe("readB2BLast7d — read-only contract", () => {
  it("the module imports nothing from QBO or HubSpot helpers", async () => {
    // Static import audit: the source file should not pull in any
    // QBO or HubSpot helper. We can't reach into the bundler, but we
    // can read the source file and assert the absence of the
    // forbidden imports — locks the no-pipeline-as-revenue and
    // no-draft-invoice-as-revenue rules at the source level.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../revenue-kpi-readers.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*qbo-client["']/);
    expect(src).not.toMatch(/from\s+["'].*qbo-auth["']/);
    expect(src).not.toMatch(/from\s+["'].*hubspot-client["']/);
    expect(src).not.toMatch(/from\s+["'].*pipeline-cache["']/);
    // Also: the existing pnl.ts getWholesaleRevenue function (which
    // reads HubSpot Closed-Won deal values from a state cache) is
    // explicitly forbidden as a B2B revenue source.
    expect(src).not.toMatch(/getWholesaleRevenue/);
  });
});
