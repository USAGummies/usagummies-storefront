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
