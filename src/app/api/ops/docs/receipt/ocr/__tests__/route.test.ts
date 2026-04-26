/**
 * Integration tests for POST /api/ops/docs/receipt/ocr.
 *
 * Locks the Phase 7 contract:
 *   - 401 when isAuthorized rejects.
 *   - 400 on missing receiptId, missing both ocrText and suggestion,
 *     or both supplied (ambiguous).
 *   - 400 on malformed `suggestion` envelope.
 *   - 404 when the receipt id doesn't exist.
 *   - 200 happy path attaches the suggestion AND preserves
 *     `status: "needs_review"` (no auto-promotion).
 *   - Canonical review fields (vendor / date / amount / category /
 *     payment_method) are NEVER touched by attachment — review is
 *     by humans only.
 *   - Static-source: the route imports nothing from QBO, HubSpot,
 *     Slack send, or vendor-create helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const store = new Map<string, unknown>();

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

import { POST } from "../route";
import { processReceipt } from "@/lib/ops/docs";

beforeEach(() => {
  store.clear();
  isAuthorizedMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function postJson(body: unknown): Request {
  return new Request("https://www.usagummies.com/api/ops/docs/receipt/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe("auth gate", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await POST(postJson({ receiptId: "r-1", ocrText: "x" }));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

describe("body validation", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("400 on missing receiptId", async () => {
    const res = await POST(postJson({ ocrText: "Acme\nTotal $5" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/receiptId/i);
  });

  it("400 when neither ocrText nor suggestion supplied", async () => {
    const res = await POST(postJson({ receiptId: "r-1" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/exactly one/i);
  });

  it("400 when BOTH ocrText and suggestion supplied (ambiguous)", async () => {
    const res = await POST(
      postJson({
        receiptId: "r-1",
        ocrText: "Acme\nTotal $5",
        suggestion: {
          vendor: null,
          date: null,
          amount: null,
          currency: null,
          tax: null,
          last4: null,
          paymentHint: null,
          confidence: "low",
          warnings: [],
          extractedAt: new Date().toISOString(),
          rawText: "",
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/ambiguous/i);
  });

  it("400 on malformed suggestion envelope", async () => {
    const res = await POST(
      postJson({
        receiptId: "r-1",
        suggestion: { vendor: 123, confidence: "very-high" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/malformed/i);
  });

  it("400 on invalid JSON body", async () => {
    const req = new Request(
      "https://www.usagummies.com/api/ops/docs/receipt/ocr",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Happy path — attach + preserve status
// ---------------------------------------------------------------------------

describe("happy path", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("404 when receiptId doesn't exist (no fabrication)", async () => {
    const res = await POST(
      postJson({ receiptId: "missing", ocrText: "Acme\nTotal $5" }),
    );
    expect(res.status).toBe(404);
  });

  it("200 + suggestion attached, status preserved as needs_review", async () => {
    // Capture a receipt with no review fields → goes into needs_review.
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    expect(captured.status).toBe("needs_review");

    const res = await POST(
      postJson({
        receiptId: captured.id,
        ocrText: "Belmark Inc\n2026-04-25\nTotal: $250.00 USD",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      receipt: {
        id: string;
        status: string;
        ocr_suggestion?: {
          vendor: string | null;
          amount: number | null;
          confidence: string;
        };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.receipt.id).toBe(captured.id);
    // CRITICAL: status preserved. Attachment must not auto-promote.
    expect(body.receipt.status).toBe("needs_review");
    // Suggestion attached.
    expect(body.receipt.ocr_suggestion?.vendor).toBe("Belmark Inc");
    expect(body.receipt.ocr_suggestion?.amount).toBe(250);
  });

  it("does NOT touch canonical review fields (no auto-fill)", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    // Capture the canonical fields (likely undefined, but we lock them).
    const before = {
      vendor: captured.vendor,
      date: captured.date,
      amount: captured.amount,
      category: captured.category,
      payment_method: captured.payment_method,
    };

    await POST(
      postJson({
        receiptId: captured.id,
        ocrText: "Belmark Inc\n2026-04-25\nTotal: $250.00 USD",
      }),
    );

    // Re-read receipt straight from KV.
    type StoredReceipt = {
      id: string;
      vendor?: string;
      date?: string;
      amount?: number;
      category?: string;
      payment_method?: string;
    };
    const all = (store.get("docs:receipts") as StoredReceipt[] | null) ?? [];
    const found = all.find((r) => r.id === captured.id);
    expect(found).toBeDefined();
    expect(found!.vendor).toBe(before.vendor);
    expect(found!.date).toBe(before.date);
    expect(found!.amount).toBe(before.amount);
    expect(found!.category).toBe(before.category);
    expect(found!.payment_method).toBe(before.payment_method);
  });

  it("attaches a pre-extracted suggestion when caller passes `suggestion`", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    const sug = {
      vendor: "External OCR Vendor",
      date: "2026-04-20",
      amount: 99.99,
      currency: "USD",
      tax: null,
      last4: "9999",
      paymentHint: "Visa",
      confidence: "high",
      warnings: [],
      extractedAt: new Date().toISOString(),
      rawText: "Provided by an external OCR provider",
    };
    const res = await POST(
      postJson({ receiptId: captured.id, suggestion: sug }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      receipt: { ocr_suggestion?: { vendor: string | null; amount: number | null } };
    };
    expect(body.receipt.ocr_suggestion?.vendor).toBe("External OCR Vendor");
    expect(body.receipt.ocr_suggestion?.amount).toBe(99.99);
  });

  it("re-attaching with new suggestion replaces (idempotent, no merge)", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });

    await POST(
      postJson({
        receiptId: captured.id,
        ocrText: "First Vendor\n2026-04-01\nTotal: $1.00",
      }),
    );
    const second = await POST(
      postJson({
        receiptId: captured.id,
        ocrText: "Second Vendor\n2026-04-25\nTotal: $2.00",
      }),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as {
      receipt: { ocr_suggestion?: { vendor: string | null; amount: number | null } };
    };
    expect(body.receipt.ocr_suggestion?.vendor).toBe("Second Vendor");
    expect(body.receipt.ocr_suggestion?.amount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Static-source assertion
// ---------------------------------------------------------------------------

describe("read-only contract — no forbidden imports", () => {
  it("the route imports nothing from QBO, HubSpot, Slack send, or vendor-create helpers", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../route.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*qbo/);
    expect(src).not.toMatch(/from\s+["'].*hubspot/);
    // No Slack send paths in this route.
    expect(src).not.toMatch(/from\s+["'].*slack-(send|client)/);
    // No vendor-create or "vendors" mutation paths.
    expect(src).not.toMatch(/createQBOVendor|onboardVendor|\/api\/ops\/vendors/);
    // GET / PUT / DELETE / PATCH are explicitly NOT exported.
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(GET|PUT|DELETE|PATCH)/);
  });
});
