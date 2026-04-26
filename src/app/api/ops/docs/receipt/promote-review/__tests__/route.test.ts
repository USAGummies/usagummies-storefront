/**
 * Integration tests for POST /api/ops/docs/receipt/promote-review.
 *
 * Locks the Phase 8 contract:
 *   - 401 on auth fail.
 *   - 400 on missing receiptId / invalid JSON.
 *   - 404 when receiptId doesn't exist.
 *   - 200 happy path returns a packet AND preserves the receipt's
 *     status + canonical fields.
 *   - taxonomy_status surfaces the missing-slug gap honestly:
 *     `has_slug: false`, reason names the fail-closed rule.
 *   - Idempotent: re-promoting the same receipt overwrites the
 *     packet by `packetId` (no duplicates in the KV blob).
 *   - Static-source: route imports nothing from QBO, HubSpot,
 *     Slack send, vendor-create, or the control-plane approvals
 *     store. (No Slack approval is opened by this lane.)
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
import { processReceipt, attachOcrSuggestion } from "@/lib/ops/docs";
import { extractReceiptFromText } from "@/lib/ops/receipt-ocr";

beforeEach(() => {
  store.clear();
  isAuthorizedMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function postJson(body: unknown): Request {
  return new Request(
    "https://www.usagummies.com/api/ops/docs/receipt/promote-review",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe("auth gate", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await POST(postJson({ receiptId: "any" }));
    expect(res.status).toBe(401);
  });

  it("calls isAuthorized once with the request", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    await POST(postJson({ receiptId: "missing" }));
    expect(isAuthorizedMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

describe("body validation", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("400 on invalid JSON", async () => {
    const req = new Request(
      "https://www.usagummies.com/api/ops/docs/receipt/promote-review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400 on missing receiptId", async () => {
    const res = await POST(postJson({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/receiptId/i);
  });

  it("400 on whitespace-only receiptId", async () => {
    const res = await POST(postJson({ receiptId: "   " }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 404 — never fabricates
// ---------------------------------------------------------------------------

describe("404 path", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("404 when receiptId doesn't exist", async () => {
    const res = await POST(postJson({ receiptId: "definitely-missing" }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; receiptId: string };
    expect(body.error).toBe("receipt not found");
    expect(body.receiptId).toBe("definitely-missing");
  });
});

// ---------------------------------------------------------------------------
// Happy path — packet built + receipt preserved
// ---------------------------------------------------------------------------

describe("happy path", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("200 + packet returned with taxonomy_status mirroring the registered slug (Phase 9)", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    const res = await POST(postJson({ receiptId: captured.id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      packet: {
        packetId: string;
        receiptId: string;
        status: string;
        eligibility: { ok: boolean; missing: string[] };
        taxonomy: { slug: string | null; classExpected: string };
        receiptStatusAtBuild: string;
      };
      approval:
        | { opened: true; id: string; status: string; requiredApprovers: string[] }
        | { opened: false; reason: string };
      taxonomy_status: {
        has_slug: boolean;
        slug: string | null;
        class_expected: string;
        reason: string;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.packet.receiptId).toBe(captured.id);
    expect(body.packet.status).toBe("draft");
    expect(body.packet.taxonomy.slug).toBe("receipt.review.promote");
    expect(body.packet.taxonomy.classExpected).toBe("B");
    // Envelope-level taxonomy_status mirrors the packet.
    expect(body.taxonomy_status.has_slug).toBe(true);
    expect(body.taxonomy_status.slug).toBe("receipt.review.promote");
    expect(body.taxonomy_status.class_expected).toBe("B");
    // No OCR / canonical fields for this captured receipt → eligibility false.
    expect(body.packet.eligibility.ok).toBe(false);
    // Phase 9: ineligible packets do NOT open an approval.
    expect(body.approval.opened).toBe(false);
    if (body.approval.opened === false) {
      expect(body.approval.reason).toMatch(/ineligible/i);
    }
  });

  it("eligibility=false with missing fields when receipt + OCR are empty", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    const res = await POST(postJson({ receiptId: captured.id }));
    const body = (await res.json()) as {
      packet: { eligibility: { ok: boolean; missing: string[] } };
    };
    expect(body.packet.eligibility.ok).toBe(false);
    expect(body.packet.eligibility.missing).toEqual([
      "vendor",
      "date",
      "amount",
      "category",
    ]);
  });

  it("eligibility=true when OCR + canonical together cover all required fields", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      category: "supplies", // canonical
    });
    const ocr = extractReceiptFromText(
      [
        "Belmark Inc",
        "2026-04-20",
        "Total: $250.00 USD",
      ].join("\n"),
    );
    await attachOcrSuggestion(captured.id, ocr);
    const res = await POST(postJson({ receiptId: captured.id }));
    const body = (await res.json()) as {
      packet: {
        eligibility: { ok: boolean };
        proposedFields: { vendor: { value: string; source: string } };
      };
    };
    expect(body.packet.eligibility.ok).toBe(true);
    expect(body.packet.proposedFields.vendor.value).toBe("Belmark Inc");
    expect(body.packet.proposedFields.vendor.source).toBe("ocr-suggested");
  });

  it("does NOT change the receipt's status (still needs_review after promote)", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    expect(captured.status).toBe("needs_review");
    await POST(postJson({ receiptId: captured.id }));
    // Re-read receipts blob from the mock KV.
    type StoredReceipt = { id: string; status: string };
    const all = (store.get("docs:receipts") as StoredReceipt[] | null) ?? [];
    const found = all.find((r) => r.id === captured.id);
    expect(found?.status).toBe("needs_review");
  });

  it("does NOT touch canonical review fields", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    const before = {
      vendor: captured.vendor,
      date: captured.date,
      amount: captured.amount,
      category: captured.category,
      payment_method: captured.payment_method,
    };
    await POST(postJson({ receiptId: captured.id }));
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

  it("idempotent: re-promoting the same receipt overwrites the packet (no duplicate)", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    await POST(postJson({ receiptId: captured.id }));
    await POST(postJson({ receiptId: captured.id }));
    type StoredPacket = { packetId: string; receiptId: string };
    const packets =
      (store.get("docs:receipt_review_packets") as StoredPacket[] | null) ?? [];
    const matches = packets.filter((p) => p.receiptId === captured.id);
    expect(matches).toHaveLength(1);
    expect(matches[0].packetId).toBe(`pkt-v1-${captured.id}`);
  });
});

// ---------------------------------------------------------------------------
// Phase 9 — eligible packets open a Class B Rene approval
// ---------------------------------------------------------------------------

describe("Phase 9 — approval-open behavior", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("eligible packet opens a Class B Rene approval and returns the id + status", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    const res = await POST(postJson({ receiptId: captured.id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      packet: { eligibility: { ok: boolean } };
      approval:
        | { opened: true; id: string; status: string; requiredApprovers: string[] }
        | { opened: false; reason: string };
    };
    expect(body.packet.eligibility.ok).toBe(true);
    expect(body.approval.opened).toBe(true);
    if (body.approval.opened) {
      expect(body.approval.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(body.approval.status).toBe("pending");
      expect(body.approval.requiredApprovers).toEqual(["Rene"]);
    }
  });

  it("idempotent on approvals — re-promote returns the existing pending approval (no duplicate)", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    const first = await POST(postJson({ receiptId: captured.id }));
    const firstBody = (await first.json()) as {
      approval: { opened: boolean; id?: string };
    };
    const second = await POST(postJson({ receiptId: captured.id }));
    const secondBody = (await second.json()) as {
      approval: { opened: boolean; id?: string };
    };
    expect(firstBody.approval.opened).toBe(true);
    expect(secondBody.approval.opened).toBe(true);
    expect(secondBody.approval.id).toBe(firstBody.approval.id);
  });

  it("ineligible packet (missing required fields) does NOT open an approval", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      // No vendor / date / amount / category — eligibility.ok=false.
    });
    const res = await POST(postJson({ receiptId: captured.id }));
    const body = (await res.json()) as {
      packet: { eligibility: { ok: boolean; missing: string[] } };
      approval:
        | { opened: true; id: string }
        | { opened: false; reason: string };
    };
    expect(body.packet.eligibility.ok).toBe(false);
    expect(body.approval.opened).toBe(false);
    if (body.approval.opened === false) {
      expect(body.approval.reason).toMatch(/ineligible/i);
      // Reason names every missing field verbatim.
      for (const f of body.packet.eligibility.missing) {
        expect(body.approval.reason).toContain(f);
      }
    }
  });

  it("does NOT change the receipt's status when an approval is opened", async () => {
    const captured = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    expect(captured.status).toBe("ready"); // all required fields → ready
    await POST(postJson({ receiptId: captured.id }));
    type StoredReceipt = { id: string; status: string };
    const all = (store.get("docs:receipts") as StoredReceipt[] | null) ?? [];
    const found = all.find((r) => r.id === captured.id);
    expect(found?.status).toBe("ready"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Static-source assertion
// ---------------------------------------------------------------------------

describe("read-only contract — no forbidden imports (Phase 9)", () => {
  it("the route imports nothing from QBO, HubSpot, Slack send/client, or vendor-create paths", async () => {
    // Phase 9 NOTE: the route DOES import from `control-plane/approvals`
    // and `control-plane/stores` to open a Class B Rene approval when
    // eligibility.ok is true. That's the deliberate Phase 9 behavior.
    // The forbidden-import set narrows: QBO/HubSpot writes,
    // Shopify/Slack-send paths, and vendor-create are still blocked.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../route.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*qbo-client/);
    expect(src).not.toMatch(/from\s+["'].*qbo-auth/);
    expect(src).not.toMatch(/from\s+["'].*hubspot/);
    expect(src).not.toMatch(/from\s+["'].*slack-(send|client)/);
    expect(src).not.toMatch(/createQBOVendor|onboardVendor|\/api\/ops\/vendors/);
    // No QBO write helpers — the approval acknowledges Rene reviewed,
    // it does NOT post to QBO. A separate Class B `qbo.bill.create`
    // runs later.
    expect(src).not.toMatch(/createQBOBill|createQBOInvoice|createQBOJournalEntry/);
    // GET / PUT / DELETE / PATCH NOT exported.
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(GET|PUT|DELETE|PATCH)/);
  });

  it("the route does NOT post to Slack directly — approval surface is the existing approvalStore.put path", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../route.ts", import.meta.url),
      "utf8",
    );
    // No direct `chat.postMessage` / `WebClient` / `slack.com/api/chat.postMessage`.
    expect(src).not.toMatch(/chat\.postMessage/);
    expect(src).not.toMatch(/WebClient/);
    expect(src).not.toMatch(/slack\.com\/api\/chat/);
  });
});
