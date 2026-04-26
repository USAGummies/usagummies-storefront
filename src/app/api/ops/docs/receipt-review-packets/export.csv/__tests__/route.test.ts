/**
 * Tests for GET /api/ops/docs/receipt-review-packets/export.csv.
 *
 * Phase 18 (Option A) — read-only CSV export. Locked rules:
 *   - 401 on auth fail.
 *   - 200 with text/csv + Content-Disposition: attachment.
 *   - Filter spec applied identically to the JSON list route
 *     (parity with `filterPacketsBySpec`).
 *   - Body is RFC-4180 CSV: fixed header order; CRLF line ends;
 *     null/undefined cells empty; never fabricated.
 *   - 500 with text/plain on KV throw — never an empty CSV
 *     silently.
 *   - Static-source: route imports nothing from QBO write helpers,
 *     HubSpot, Shopify writes, Slack send, or `openApproval` /
 *     `buildApprovalRequest`. Only GET exported.
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

function makeReq(
  path = "/api/ops/docs/receipt-review-packets/export.csv",
): Request {
  return new Request(`https://www.usagummies.com${path}`, { method: "GET" });
}

describe("auth gate", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    // 401 surface is JSON for tooling, not CSV (we haven't shown
    // the operator the file yet).
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });
});

describe("happy path", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("200 with text/csv + Content-Disposition: attachment", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/csv/);
    const disposition = res.headers.get("Content-Disposition");
    expect(disposition).toContain("attachment");
    expect(disposition).toMatch(/usa-gummies-review-packets-\d{4}-\d{2}-\d{2}\.csv/);
  });

  it("Cache-Control is no-store (never serve a stale CSV from CDN)", async () => {
    const res = await GET(makeReq());
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("body is RFC-4180 CSV with the locked header row", async () => {
    const res = await GET(makeReq());
    const csv = await res.text();
    const headerLine = csv.split("\r\n")[0];
    expect(headerLine).toBe(
      "status,packetId,receiptId,vendor,vendorSource,amountUsd,amountSource,currency,eligibilityOk,eligibilityMissing,approvalId,approvalStatus,createdAt",
    );
  });

  it("empty queue → header-only CSV", async () => {
    const res = await GET(makeReq());
    const csv = await res.text();
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(2); // header + trailing empty
    expect(lines[1]).toBe("");
  });

  it("includes one row per packet", async () => {
    const r1 = await processReceipt({
      source_url: "https://example.com/a.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    const r2 = await processReceipt({
      source_url: "https://example.com/b.jpg",
      source_channel: "test",
      vendor: "Albanese",
      date: "2026-04-22",
      amount: 1200,
      category: "supplies",
    });
    await requestReceiptReviewPromotion(r1.id);
    await requestReceiptReviewPromotion(r2.id);

    const res = await GET(makeReq());
    const csv = await res.text();
    const lines = csv.split("\r\n");
    // header + 2 data rows + trailing empty
    expect(lines.length).toBe(4);
    expect(csv).toContain("Belmark Inc");
    expect(csv).toContain("Albanese");
  });
});

describe("filter parity with the JSON list route", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("vendor filter narrows the CSV the same way it narrows the JSON list", async () => {
    const r1 = await processReceipt({
      source_url: "https://example.com/a.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    const r2 = await processReceipt({
      source_url: "https://example.com/b.jpg",
      source_channel: "test",
      vendor: "Albanese",
      date: "2026-04-22",
      amount: 1200,
      category: "supplies",
    });
    await requestReceiptReviewPromotion(r1.id);
    await requestReceiptReviewPromotion(r2.id);

    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets/export.csv?vendor=belmark"),
    );
    const csv = await res.text();
    expect(csv).toContain("Belmark Inc");
    expect(csv).not.toContain("Albanese");
  });

  it("status filter narrows", async () => {
    const r = await processReceipt({
      source_url: "https://example.com/x.jpg",
      source_channel: "test",
      vendor: "Test",
      date: "2026-04-20",
      amount: 5,
      category: "supplies",
    });
    await requestReceiptReviewPromotion(r.id);
    // packet status defaults to "draft" — filter to that, expect 1 row.
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets/export.csv?status=draft"),
    );
    const csv = await res.text();
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2); // header + 1 data row
  });

  it("filter narrows to zero → header-only CSV (no fabrication)", async () => {
    const r = await processReceipt({
      source_url: "https://example.com/x.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r.id);
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets/export.csv?vendor=no-such-vendor-anywhere",
      ),
    );
    const csv = await res.text();
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(2); // header + trailing empty
  });

  it("unknown query params are ignored (URL tracking compat)", async () => {
    const r = await processReceipt({
      source_url: "https://example.com/x.jpg",
      source_channel: "test",
    });
    await requestReceiptReviewPromotion(r.id);
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets/export.csv?utm_source=slack&random=foo",
      ),
    );
    expect(res.status).toBe(200);
  });
});

describe("error path", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("KV throw → 500 text/plain with reason (never empty CSV)", async () => {
    kvShouldThrow = true;
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
    const body = await res.text();
    expect(body).toMatch(/csv_export_failed/);
    expect(body).toContain("ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------
// Phase 21 — cursor pagination on the CSV export
// ---------------------------------------------------------------------------
//
// The CSV route accepts `?cursor=...` (matching the Phase 17 cursor
// shape used by the JSON list route) so queues larger than the
// storage cap can be exported via repeated requests. Backward
// compatibility for the dashboard's "Export CSV" button: a request
// with no cursor returns the first page (up to `limit`, default 500),
// just like Phase 18.
//
// What we lock here:
//   - `X-Matched-Total` is always set, equals the FULL filtered set
//     (NOT the page length).
//   - `X-Next-Cursor` + `Link: rel="next"` are present iff more
//     pages remain.
//   - `X-Next-Cursor` + `Link` are absent (NOT empty string, NOT
//     "null") on the final page.
//   - Cursor traversal visits every packet exactly once.
//   - Filters apply BEFORE pagination — cursor walks the FILTERED
//     set, not the unfiltered storage.
//   - Malformed cursor falls back to first page (no fabrication,
//     no throw).
//   - Backward compat: request with no cursor returns the same body
//     as Phase 18 when the queue fits in one page.

describe("Phase 21 — cursor pagination", () => {
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

  it("X-Matched-Total reflects the filtered set length (not page length)", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets/export.csv?limit=2"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Matched-Total")).toBe("5");
    // Page is just 2 rows (header + 2 + trailing-empty).
    const lines = (await res.text()).split("\r\n");
    expect(lines.length).toBe(4);
  });

  it("X-Next-Cursor + Link rel=next present when more pages remain", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets/export.csv?limit=2"),
    );
    const next = res.headers.get("X-Next-Cursor");
    expect(typeof next).toBe("string");
    expect((next as string).length).toBeGreaterThan(0);
    const link = res.headers.get("Link");
    expect(link).toContain('rel="next"');
    expect(link).toContain(`cursor=${encodeURIComponent(next as string)}`);
  });

  it("X-Next-Cursor + Link rel=next ABSENT on the final page (never empty / 'null')", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq("/api/ops/docs/receipt-review-packets/export.csv?limit=100"),
    );
    expect(res.headers.get("X-Next-Cursor")).toBeNull();
    expect(res.headers.get("Link")).toBeNull();
    expect(res.headers.get("X-Matched-Total")).toBe("5");
  });

  it("traversing all cursors visits every packet exactly once", async () => {
    await seedFivePackets();
    const seenPackets = new Set<string>();
    let cursor: string | null = null;
    for (let safety = 0; safety < 20; safety++) {
      const path = cursor
        ? `/api/ops/docs/receipt-review-packets/export.csv?limit=2&cursor=${encodeURIComponent(cursor)}`
        : "/api/ops/docs/receipt-review-packets/export.csv?limit=2";
      const res = await GET(makeReq(path));
      const csv = await res.text();
      // Each non-header / non-empty row's 2nd column is the packetId.
      const lines = csv.split("\r\n");
      for (const line of lines.slice(1)) {
        if (line.length === 0) continue;
        const cols = line.split(",");
        // packetId is column index 1 (0-based) per the locked header.
        seenPackets.add(cols[1]!);
      }
      cursor = res.headers.get("X-Next-Cursor");
      if (!cursor) break;
    }
    expect(seenPackets.size).toBe(5);
  });

  it("malformed cursor falls back to first page (no fabrication, no throw)", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets/export.csv?limit=2&cursor=not-a-real-cursor",
      ),
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    const dataLines = csv.split("\r\n").filter((l) => l.length > 0);
    // header + 2 data rows
    expect(dataLines.length).toBe(3);
    // X-Matched-Total still reflects full filtered set.
    expect(res.headers.get("X-Matched-Total")).toBe("5");
  });

  it("filters apply BEFORE pagination — cursor walks the filtered set", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets/export.csv?limit=10&vendor=Vendor 1",
      ),
    );
    expect(res.status).toBe(200);
    // Vendor "Vendor 1" matches just one packet; X-Matched-Total
    // reports the filtered set size, not the unfiltered storage.
    expect(res.headers.get("X-Matched-Total")).toBe("1");
    // No more pages remain (1 row fits in limit=10).
    expect(res.headers.get("X-Next-Cursor")).toBeNull();
    expect(res.headers.get("Link")).toBeNull();
  });

  it("backward compat: no cursor + small queue fits in one page (Phase 18 behavior preserved)", async () => {
    const r = await processReceipt({
      source_url: "https://example.com/x.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    await requestReceiptReviewPromotion(r.id);

    const res = await GET(makeReq());
    const csv = await res.text();
    expect(res.status).toBe(200);
    // Same Phase 18 contract: header + 1 data row + trailing empty.
    expect(csv.split("\r\n").length).toBe(3);
    expect(res.headers.get("X-Matched-Total")).toBe("1");
    // No nextCursor — entire set fit in default limit=500.
    expect(res.headers.get("X-Next-Cursor")).toBeNull();
    expect(res.headers.get("Link")).toBeNull();
  });

  it("Link header URL preserves filter params (next page keeps the same filter)", async () => {
    await seedFivePackets();
    const res = await GET(
      makeReq(
        "/api/ops/docs/receipt-review-packets/export.csv?limit=2&status=draft",
      ),
    );
    const link = res.headers.get("Link");
    expect(link).not.toBeNull();
    // Extract the URL between < and >.
    const match = (link as string).match(/^<([^>]+)>/);
    expect(match).not.toBeNull();
    const nextUrl = new URL(match![1]!);
    expect(nextUrl.searchParams.get("status")).toBe("draft");
    expect(nextUrl.searchParams.get("limit")).toBe("2");
    expect(nextUrl.searchParams.get("cursor")).toBeTruthy();
  });

  it("limit clamps to [1, 500]", async () => {
    await seedFivePackets();
    const res0 = await GET(
      makeReq("/api/ops/docs/receipt-review-packets/export.csv?limit=0"),
    );
    const resHi = await GET(
      makeReq("/api/ops/docs/receipt-review-packets/export.csv?limit=999999"),
    );
    expect(res0.status).toBe(200);
    expect(resHi.status).toBe(200);
    // limit=0 clamps to 1 → page has 1 row + header + trailing empty
    const lines0 = (await res0.text()).split("\r\n");
    expect(lines0.length).toBe(3);
    // limit=hi clamps to 500 → entire seeded set (5) fits
    expect(resHi.headers.get("X-Matched-Total")).toBe("5");
    expect(resHi.headers.get("X-Next-Cursor")).toBeNull();
  });
});

describe("read-only contract — no forbidden imports", () => {
  it("the route imports nothing from QBO write helpers, HubSpot, Shopify writes, Slack send, openApproval/buildApprovalRequest", async () => {
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
    // (tolerates names appearing in JSDoc comments).
    expect(src).not.toMatch(/import[^;]*\bopenApproval\b/);
    expect(src).not.toMatch(/import[^;]*\bbuildApprovalRequest\b/);
    expect(src).not.toMatch(/\bopenApproval\s*\(/);
    expect(src).not.toMatch(/\bbuildApprovalRequest\s*\(/);
    // Only GET exported.
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|DELETE|PATCH)/);
  });
});
