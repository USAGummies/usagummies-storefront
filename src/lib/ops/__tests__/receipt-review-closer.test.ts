/**
 * Tests for the Phase 10 `receipt.review.promote` closer.
 *
 * Locks the contract:
 *   - Pure transition `applyDecisionToPacket`:
 *     - approve → "rene-approved"
 *     - reject  → "rejected"
 *     - ask     → null (no transition; packet stays draft)
 *     - terminal-state input → null (idempotent / no double-fire)
 *     - canonical / proposedFields / eligibility / taxonomy /
 *       ocrSuggestion / receiptStatusAtBuild are NEVER mutated.
 *   - Closer gating:
 *     - non-receipt-review approval → handled: false
 *     - pending approval → handled: false (only terminal states fire)
 *     - missing/malformed targetEntity.id → handled: true, ok: false
 *   - Closer success path:
 *     - approved approval → packet status flips to "rene-approved"
 *     - rejected approval → packet status flips to "rejected"
 *     - ONLY the `status` field changes; canonical, ocr_suggestion,
 *       eligibility, taxonomy, receiptStatusAtBuild are unchanged
 *   - Closer NEVER calls QBO/HubSpot/Shopify (static-source asserted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyDecisionToPacket,
  buildReceiptReviewPacket,
} from "../receipt-review-packet";
import type { ReceiptReviewPacket } from "../receipt-review-packet";
import type { ReceiptRecord } from "../docs";

const FIXED_NOW = new Date("2026-04-25T12:00:00Z");

function mkReceipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: "receipt-1",
    source_url: "https://example.com/receipt.jpg",
    source_channel: "test",
    status: "needs_review",
    processed_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

function mkPacket(overrides: Partial<ReceiptReviewPacket> = {}): ReceiptReviewPacket {
  return {
    ...buildReceiptReviewPacket(mkReceipt(), { now: FIXED_NOW }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure transition — applyDecisionToPacket
// ---------------------------------------------------------------------------

describe("applyDecisionToPacket — pure transitions", () => {
  it("approve on a draft packet → rene-approved", () => {
    const p = mkPacket();
    const next = applyDecisionToPacket(p, "approve");
    expect(next).not.toBeNull();
    expect(next!.status).toBe("rene-approved");
  });

  it("reject on a draft packet → rejected", () => {
    const p = mkPacket();
    const next = applyDecisionToPacket(p, "reject");
    expect(next).not.toBeNull();
    expect(next!.status).toBe("rejected");
  });

  it("ask on any packet → null (no transition; clarification path)", () => {
    expect(applyDecisionToPacket(mkPacket({ status: "draft" }), "ask")).toBeNull();
    expect(applyDecisionToPacket(mkPacket({ status: "rene-approved" }), "ask")).toBeNull();
    expect(applyDecisionToPacket(mkPacket({ status: "rejected" }), "ask")).toBeNull();
  });

  it("re-applying any decision to a terminal packet → null (idempotent)", () => {
    const approved = mkPacket({ status: "rene-approved" });
    expect(applyDecisionToPacket(approved, "approve")).toBeNull();
    expect(applyDecisionToPacket(approved, "reject")).toBeNull();
    const rejected = mkPacket({ status: "rejected" });
    expect(applyDecisionToPacket(rejected, "approve")).toBeNull();
    expect(applyDecisionToPacket(rejected, "reject")).toBeNull();
  });

  it("transition leaves canonical / proposedFields / eligibility / taxonomy / ocrSuggestion / receiptStatusAtBuild untouched", () => {
    const p = mkPacket();
    const before = JSON.stringify({
      canonical: p.canonical,
      proposedFields: p.proposedFields,
      eligibility: p.eligibility,
      taxonomy: p.taxonomy,
      ocrSuggestion: p.ocrSuggestion,
      receiptStatusAtBuild: p.receiptStatusAtBuild,
      receiptId: p.receiptId,
      packetId: p.packetId,
      createdAt: p.createdAt,
    });
    const next = applyDecisionToPacket(p, "approve");
    const after = JSON.stringify({
      canonical: next!.canonical,
      proposedFields: next!.proposedFields,
      eligibility: next!.eligibility,
      taxonomy: next!.taxonomy,
      ocrSuggestion: next!.ocrSuggestion,
      receiptStatusAtBuild: next!.receiptStatusAtBuild,
      receiptId: next!.receiptId,
      packetId: next!.packetId,
      createdAt: next!.createdAt,
    });
    expect(after).toBe(before);
  });

  it("does not mutate the input packet (returns a new object)", () => {
    const p = mkPacket();
    const before = JSON.stringify(p);
    applyDecisionToPacket(p, "approve");
    expect(JSON.stringify(p)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Closer gating + success path — uses an in-memory KV mock so the
// `updateReceiptReviewPacketStatus` storage call is observable.
// ---------------------------------------------------------------------------

const store = new Map<string, unknown>();

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({
    append: vi.fn(async () => {}),
  }),
}));

vi.mock("@/lib/ops/control-plane/slack", () => ({
  auditSurface: () => ({
    mirror: vi.fn(async () => {}),
  }),
}));

import { executeApprovedReceiptReviewPromote } from "../receipt-review-closer";
import {
  processReceipt,
  requestReceiptReviewPromotion,
  getReceiptReviewPacket,
} from "../docs";
import type { ApprovalRequest } from "@/lib/ops/control-plane/types";

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

function mkApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "appr-1",
    runId: "run-1",
    division: "financials",
    actorAgentId: "ops-route:receipt-promote",
    class: "B",
    action: "Acknowledge a captured receipt + OCR suggestion as Rene-reviewed",
    targetSystem: "internal-receipts",
    targetEntity: {
      type: "receipt-review-packet",
      id: "pkt-v1-receipt-test",
      label: "Belmark Inc",
    },
    payloadPreview: "test",
    evidence: { claim: "test", sources: [], confidence: 0.9 },
    rollbackPlan: "test",
    requiredApprovers: ["Rene"],
    status: "approved",
    createdAt: FIXED_NOW.toISOString(),
    decisions: [
      {
        approver: "Rene",
        decision: "approve",
        decidedAt: FIXED_NOW.toISOString(),
      },
    ],
    escalateAt: FIXED_NOW.toISOString(),
    expiresAt: FIXED_NOW.toISOString(),
    ...overrides,
  } as ApprovalRequest;
}

describe("executeApprovedReceiptReviewPromote — gating", () => {
  it("non-receipt-review approval → handled: false", async () => {
    const r = await executeApprovedReceiptReviewPromote(
      mkApproval({
        targetEntity: { type: "ap-packet", id: "ap-packet:foo" },
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.handled).toBe(false);
    if (!r.handled) {
      expect(r.reason).toMatch(/not a receipt-review-packet/i);
    }
  });

  it("missing targetEntity → handled: false", async () => {
    const r = await executeApprovedReceiptReviewPromote(
      mkApproval({ targetEntity: undefined }),
    );
    expect(r.handled).toBe(false);
  });

  it("pending approval (non-terminal) → handled: false", async () => {
    const r = await executeApprovedReceiptReviewPromote(
      mkApproval({ status: "pending" }),
    );
    expect(r.handled).toBe(false);
    if (!r.handled) {
      expect(r.reason).toMatch(/not terminal/i);
    }
  });

  it("malformed targetEntity.id (no pkt-v1- prefix) → handled: true, ok: false", async () => {
    const r = await executeApprovedReceiptReviewPromote(
      mkApproval({
        targetEntity: { type: "receipt-review-packet", id: "wrong-prefix-foo" },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.handled).toBe(true);
    if (!r.ok) {
      expect(r.error).toMatch(/missing valid targetEntity\.id/i);
    }
  });
});

describe("executeApprovedReceiptReviewPromote — success path (approved)", () => {
  it("flips packet status from draft → rene-approved when approval is approved", async () => {
    // Set up a captured receipt + a packet in the KV store.
    const receipt = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    const packet = await requestReceiptReviewPromotion(receipt.id);
    expect(packet?.status).toBe("draft");

    const result = await executeApprovedReceiptReviewPromote(
      mkApproval({
        status: "approved",
        targetEntity: {
          type: "receipt-review-packet",
          id: packet!.packetId,
          label: "Belmark Inc",
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.handled).toBe(true);
    if (result.ok && result.handled) {
      expect(result.kind).toBe("receipt-review-promote");
      expect(result.packetId).toBe(packet!.packetId);
      expect(result.newStatus).toBe("rene-approved");
      expect(result.threadMessage).toMatch(/approved by Rene/i);
      expect(result.threadMessage).toMatch(/qbo\.bill\.create/);
    }

    const reread = await getReceiptReviewPacket(packet!.packetId);
    expect(reread?.status).toBe("rene-approved");
  });

  it("flips packet status from draft → rejected when approval is rejected", async () => {
    const receipt = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    const packet = await requestReceiptReviewPromotion(receipt.id);

    const result = await executeApprovedReceiptReviewPromote(
      mkApproval({
        status: "rejected",
        decisions: [
          {
            approver: "Rene",
            decision: "reject",
            reason: "wrong category",
            decidedAt: FIXED_NOW.toISOString(),
          },
        ],
        targetEntity: {
          type: "receipt-review-packet",
          id: packet!.packetId,
          label: "Belmark Inc",
        },
      }),
    );
    expect(result.handled).toBe(true);
    if (result.ok && result.handled) {
      expect(result.newStatus).toBe("rejected");
      expect(result.threadMessage).toMatch(/rejected by Rene/i);
    }

    const reread = await getReceiptReviewPacket(packet!.packetId);
    expect(reread?.status).toBe("rejected");
  });

  it("ONLY the packet's status field changes — canonical, ocr_suggestion, eligibility, taxonomy, receiptStatusAtBuild are untouched", async () => {
    const receipt = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    const before = await requestReceiptReviewPromotion(receipt.id);

    await executeApprovedReceiptReviewPromote(
      mkApproval({
        status: "approved",
        targetEntity: {
          type: "receipt-review-packet",
          id: before!.packetId,
          label: "Belmark Inc",
        },
      }),
    );

    const after = await getReceiptReviewPacket(before!.packetId);
    expect(after).not.toBeNull();
    expect(after!.canonical).toEqual(before!.canonical);
    expect(after!.proposedFields).toEqual(before!.proposedFields);
    expect(after!.eligibility).toEqual(before!.eligibility);
    expect(after!.taxonomy).toEqual(before!.taxonomy);
    expect(after!.ocrSuggestion).toEqual(before!.ocrSuggestion);
    expect(after!.receiptStatusAtBuild).toBe(before!.receiptStatusAtBuild);
    expect(after!.packetId).toBe(before!.packetId);
    expect(after!.receiptId).toBe(before!.receiptId);
    expect(after!.createdAt).toBe(before!.createdAt);
    // Only this field changed.
    expect(after!.status).toBe("rene-approved");
    expect(before!.status).toBe("draft");
  });

  it("does NOT change the receipt's status (needs_review/ready preserved)", async () => {
    const receipt = await processReceipt({
      source_url: "https://example.com/receipt.jpg",
      source_channel: "test",
      vendor: "Belmark Inc",
      date: "2026-04-20",
      amount: 250,
      category: "supplies",
    });
    expect(receipt.status).toBe("ready"); // all required fields → ready
    const packet = await requestReceiptReviewPromotion(receipt.id);

    await executeApprovedReceiptReviewPromote(
      mkApproval({
        status: "approved",
        targetEntity: {
          type: "receipt-review-packet",
          id: packet!.packetId,
          label: "Belmark Inc",
        },
      }),
    );

    type StoredReceipt = { id: string; status: string };
    const all = (store.get("docs:receipts") as StoredReceipt[] | null) ?? [];
    const found = all.find((r) => r.id === receipt.id);
    expect(found?.status).toBe("ready"); // unchanged
  });

  it("packet not found in KV → handled: true, ok: false (no silent success)", async () => {
    const result = await executeApprovedReceiptReviewPromote(
      mkApproval({
        status: "approved",
        targetEntity: {
          type: "receipt-review-packet",
          id: "pkt-v1-nonexistent",
          label: "Phantom",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.handled).toBe(true);
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Static-source — closer never reaches into QBO / HubSpot / Shopify
// ---------------------------------------------------------------------------

describe("read-only contract — closer source has no forbidden imports", () => {
  it("the closer module imports nothing from QBO, HubSpot, Shopify, Slack-send/client, vendor-create, or QBO write helpers", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../receipt-review-closer.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*qbo-client/);
    expect(src).not.toMatch(/from\s+["'].*qbo-auth/);
    expect(src).not.toMatch(/from\s+["'].*hubspot/);
    expect(src).not.toMatch(/from\s+["'].*shopify-/);
    expect(src).not.toMatch(/from\s+["'].*slack-(send|client)/);
    expect(src).not.toMatch(/createQBOVendor|onboardVendor|\/api\/ops\/vendors/);
    expect(src).not.toMatch(/createQBOBill|createQBOInvoice|createQBOJournalEntry/);
    expect(src).not.toMatch(/chat\.postMessage|WebClient/);
  });
});
