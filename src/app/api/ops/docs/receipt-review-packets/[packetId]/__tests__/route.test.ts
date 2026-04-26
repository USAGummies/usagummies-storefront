/**
 * Tests for GET /api/ops/docs/receipt-review-packets/[packetId].
 *
 * Phase 12 — read-only status route. Locked rules:
 *   - Auth-gated. 401 on isAuthorized rejection.
 *   - 400 on missing/whitespace packetId.
 *   - 404 when packet not found in KV.
 *   - 200 returns { packetStatus, approvalStatus } verbatim.
 *   - approvalStatus = null when no approval has been opened yet.
 *   - Static-source: route imports nothing from QBO/HubSpot/Shopify
 *     write helpers, no Slack chat.postMessage. No mutation of any
 *     receipt/packet/approval state.
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

import { GET } from "../route";
import {
  processReceipt,
  requestReceiptReviewPromotion,
  updateReceiptReviewPacketStatus,
} from "@/lib/ops/docs";

beforeEach(() => {
  store.clear();
  isAuthorizedMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(packetId: string): Request {
  return new Request(
    `https://www.usagummies.com/api/ops/docs/receipt-review-packets/${encodeURIComponent(packetId)}`,
    { method: "GET" },
  );
}

function makeCtx(packetId: string) {
  return { params: Promise.resolve({ packetId }) };
}

describe("auth gate", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq("any"), makeCtx("any"));
    expect(res.status).toBe(401);
  });
});

describe("body validation", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("400 on whitespace-only packetId", async () => {
    const res = await GET(makeReq("   "), makeCtx("   "));
    expect(res.status).toBe(400);
  });
});

describe("404 path", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("404 when packetId not found in KV", async () => {
    const res = await GET(
      makeReq("pkt-v1-nonexistent"),
      makeCtx("pkt-v1-nonexistent"),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; packetId: string };
    expect(body.error).toBe("packet not found");
    expect(body.packetId).toBe("pkt-v1-nonexistent");
  });
});

describe("happy path", () => {
  beforeEach(() => isAuthorizedMock.mockResolvedValue(true));

  it("returns 200 with packetStatus + null approvalStatus when packet was never promoted", async () => {
    const receipt = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    const packet = await requestReceiptReviewPromotion(receipt.id);
    expect(packet?.status).toBe("draft");

    const res = await GET(
      makeReq(packet!.packetId),
      makeCtx(packet!.packetId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      packetId: string;
      receiptId: string;
      packetStatus: string;
      approvalStatus: string | null;
      approvalId: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.packetId).toBe(packet!.packetId);
    expect(body.receiptId).toBe(receipt.id);
    expect(body.packetStatus).toBe("draft");
    expect(body.approvalStatus).toBeNull();
    expect(body.approvalId).toBeNull();
  });

  it("reflects packetStatus updates after the closer transitions it (rene-approved)", async () => {
    const receipt = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    const packet = await requestReceiptReviewPromotion(receipt.id);
    // Simulate the closer running.
    await updateReceiptReviewPacketStatus(packet!.packetId, "rene-approved");

    const res = await GET(
      makeReq(packet!.packetId),
      makeCtx(packet!.packetId),
    );
    const body = (await res.json()) as { packetStatus: string };
    expect(body.packetStatus).toBe("rene-approved");
  });

  it("reflects packetStatus = 'rejected' after closer runs", async () => {
    const receipt = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      vendor: "Acme",
      date: "2026-04-20",
      amount: 100,
      category: "supplies",
    });
    const packet = await requestReceiptReviewPromotion(receipt.id);
    await updateReceiptReviewPacketStatus(packet!.packetId, "rejected");

    const res = await GET(
      makeReq(packet!.packetId),
      makeCtx(packet!.packetId),
    );
    const body = (await res.json()) as { packetStatus: string };
    expect(body.packetStatus).toBe("rejected");
  });

  it("does NOT mutate any state — packetId remains 'draft' after multiple GETs", async () => {
    const receipt = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
    });
    const packet = await requestReceiptReviewPromotion(receipt.id);

    // Multiple GETs.
    await GET(makeReq(packet!.packetId), makeCtx(packet!.packetId));
    await GET(makeReq(packet!.packetId), makeCtx(packet!.packetId));
    await GET(makeReq(packet!.packetId), makeCtx(packet!.packetId));

    type StoredPacket = { packetId: string; status: string };
    const packets =
      (store.get("docs:receipt_review_packets") as StoredPacket[] | null) ?? [];
    const found = packets.find((p) => p.packetId === packet!.packetId);
    expect(found?.status).toBe("draft"); // unchanged
  });
});

describe("read-only contract — no forbidden imports", () => {
  it("the route imports nothing from QBO writes, HubSpot, Shopify, Slack send/client/post", async () => {
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
    // Only GET is exported — no POST/PUT/DELETE/PATCH.
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|DELETE|PATCH)/);
    // openApproval / buildApprovalRequest are NOT in this read route.
    expect(src).not.toMatch(/openApproval|buildApprovalRequest/);
  });
});
