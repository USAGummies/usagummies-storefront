/**
 * Finance Today aggregator coverage — Build 5 close-out.
 *
 * Pins:
 *   - Counts pending receipt-promote approvals + total finance approvals.
 *   - Counts packets by status (draft / rene-approved / rejected) +
 *     surfaces the actionable bucket (draft + eligible).
 *   - Top packets priority: draft+eligible → rene-approved → draft+warnings → rejected.
 *   - Oldest pending approvals: 5 oldest by createdAt + age in days.
 *   - Posture: red on stale ≥3d, yellow on work waiting, green on clean.
 *   - Degraded passthrough.
 */
import { describe, expect, it } from "vitest";

import { summarizeFinanceToday } from "../finance-today";
import type { ApprovalRequest, DivisionId } from "../control-plane/types";
import type { ReceiptReviewPacket } from "../receipt-review-packet";

const NOW = new Date("2026-05-02T18:00:00Z");

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "a-1",
    runId: "run-1",
    division: "financials" as DivisionId,
    actorAgentId: "ops-route:receipt-promote",
    class: "B",
    action: "Rene-review acknowledgment for receipt rcpt-1",
    targetSystem: "internal-receipts",
    targetEntity: { type: "receipt-review-packet", id: "pkt-v1-rcpt-1" },
    payloadPreview: "vendor: Albanese\namount: 100",
    evidence: { claim: "x", sources: [], confidence: 0.9 },
    rollbackPlan: "x",
    requiredApprovers: ["rene"] as never,
    status: "pending" as never,
    createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
    decisions: [],
    escalateAt: new Date(NOW.getTime() + 22 * 3600 * 1000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 70 * 3600 * 1000).toISOString(),
    ...overrides,
  };
}

function packet(overrides: Partial<ReceiptReviewPacket> = {}): ReceiptReviewPacket {
  const base: ReceiptReviewPacket = {
    packetId: "pkt-v1-rcpt-1",
    receiptId: "rcpt-1",
    canonical: {
      vendor: "Albanese",
      date: "2026-05-01",
      amount: 100,
      category: "ingredients",
      payment_method: "boa-7020",
    },
    proposedFields: {
      vendor: { value: "Albanese", source: "canonical" },
      date: { value: "2026-05-01", source: "canonical" },
      amount: { value: 100, source: "canonical" },
      category: { value: "ingredients", source: "canonical" },
    },
    ocr: {
      vendor: { value: "Albanese", confidence: 0.95 },
      date: { value: "2026-05-01", confidence: 0.92 },
      amount: { value: 100, confidence: 0.99 },
      category: { value: "ingredients", confidence: 0.8 },
      raw_text: "(omitted)",
    },
    eligibility: { ok: true, warnings: [], missing: [] },
    status: "draft",
    createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
    updatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  } as unknown as ReceiptReviewPacket;
  return { ...base, ...overrides } as ReceiptReviewPacket;
}

describe("summarizeFinanceToday — counts", () => {
  it("filters approvals to financials division only", () => {
    const r = summarizeFinanceToday({
      pendingApprovals: [
        approval({ id: "fin-1" }),
        approval({
          id: "non-fin",
          division: "production-supply-chain" as DivisionId,
        }),
      ],
      packets: [],
      now: NOW,
    });
    expect(r.pendingFinanceApprovals).toBe(1);
  });

  it("recognizes receipt-promote approvals via targetEntity OR action text", () => {
    const r = summarizeFinanceToday({
      pendingApprovals: [
        approval({
          id: "by-entity",
          action: "Other approval",
          targetEntity: { type: "receipt-review-packet", id: "pkt-1" },
        }),
        approval({
          id: "by-action",
          action: "receipt.review.promote — vendor X",
          targetEntity: undefined,
        }),
        approval({
          id: "non-promote",
          action: "qbo.bill.create — Powers",
          targetEntity: { type: "qbo-bill", id: "bill-1" },
        }),
      ],
      packets: [],
      now: NOW,
    });
    expect(r.pendingPromote).toBe(2);
    expect(r.pendingFinanceApprovals).toBe(3);
  });

  it("counts packets by status", () => {
    const r = summarizeFinanceToday({
      pendingApprovals: [],
      packets: [
        packet({ packetId: "p-draft-1", status: "draft" }),
        packet({ packetId: "p-draft-2", status: "draft" }),
        packet({ packetId: "p-approved", status: "rene-approved" }),
        packet({ packetId: "p-rejected", status: "rejected" }),
      ],
      now: NOW,
    });
    expect(r.draftPackets).toBe(2);
    expect(r.reneApprovedPackets).toBe(1);
    expect(r.rejectedPackets).toBe(1);
  });

  it("draftEligiblePackets only counts eligible drafts", () => {
    const r = summarizeFinanceToday({
      pendingApprovals: [],
      packets: [
        packet({
          packetId: "p-eligible",
          status: "draft",
          eligibility: { ok: true, warnings: [], missing: [] },
        }),
        packet({
          packetId: "p-warn",
          status: "draft",
          eligibility: { ok: false, warnings: ["missing-amount"], missing: ["amount"] },
        }),
      ],
      now: NOW,
    });
    expect(r.draftPackets).toBe(2);
    expect(r.draftEligiblePackets).toBe(1);
  });
});

describe("summarizeFinanceToday — top packets ordering", () => {
  it("draft+eligible → rene-approved → draft+warnings → rejected", () => {
    const arr = [
      packet({ packetId: "rejected", status: "rejected" }),
      packet({
        packetId: "warn",
        status: "draft",
        eligibility: { ok: false, warnings: ["x"], missing: ["amount"] },
      }),
      packet({ packetId: "approved", status: "rene-approved" }),
      packet({ packetId: "eligible", status: "draft" }),
    ];
    const r = summarizeFinanceToday({
      pendingApprovals: [],
      packets: arr,
      now: NOW,
    });
    expect(r.topPackets.map((p) => p.packetId)).toEqual([
      "eligible",
      "approved",
      "warn",
      "rejected",
    ]);
  });

  it("topPackets caps at 5", () => {
    const arr = [];
    for (let i = 0; i < 10; i++) {
      arr.push(packet({ packetId: `p-${i}`, status: "draft" }));
    }
    const r = summarizeFinanceToday({
      pendingApprovals: [],
      packets: arr,
      now: NOW,
    });
    expect(r.topPackets).toHaveLength(5);
  });
});

describe("summarizeFinanceToday — oldest pending approvals", () => {
  it("returns 5 oldest with ageDays", () => {
    const arr: ApprovalRequest[] = [];
    for (let i = 0; i < 7; i++) {
      arr.push(
        approval({
          id: `a-${i}`,
          createdAt: new Date(
            NOW.getTime() - (i + 1) * 24 * 3600 * 1000,
          ).toISOString(),
        }),
      );
    }
    const r = summarizeFinanceToday({
      pendingApprovals: arr,
      packets: [],
      now: NOW,
    });
    expect(r.oldestPendingApprovals).toHaveLength(5);
    // Oldest first → a-6 (created 7 days ago)
    expect(r.oldestPendingApprovals[0].id).toBe("a-6");
    expect(r.oldestPendingApprovals[0].ageDays).toBe(7);
  });
});

describe("summarizeFinanceToday — posture", () => {
  it("green when no work waiting", () => {
    const r = summarizeFinanceToday({
      pendingApprovals: [],
      packets: [packet({ status: "rene-approved" })],
      now: NOW,
    });
    expect(r.posture).toBe("green");
  });

  it("yellow when pending approvals exist (recent)", () => {
    const r = summarizeFinanceToday({
      pendingApprovals: [
        approval({
          createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
        }),
      ],
      packets: [],
      now: NOW,
    });
    expect(r.posture).toBe("yellow");
  });

  it("red when an approval is ≥3 days old", () => {
    const r = summarizeFinanceToday({
      pendingApprovals: [
        approval({
          id: "stale",
          createdAt: new Date(
            NOW.getTime() - 4 * 24 * 3600 * 1000,
          ).toISOString(),
        }),
      ],
      packets: [],
      now: NOW,
    });
    expect(r.posture).toBe("red");
  });

  it("yellow when only draft+eligible packets exist (no approvals open)", () => {
    const r = summarizeFinanceToday({
      pendingApprovals: [],
      packets: [packet({ status: "draft" })],
      now: NOW,
    });
    expect(r.posture).toBe("yellow");
  });
});

describe("summarizeFinanceToday — degraded passthrough", () => {
  it("forwards degraded list", () => {
    const r = summarizeFinanceToday({
      pendingApprovals: [],
      packets: [],
      degraded: ["approval-store: timeout"],
      now: NOW,
    });
    expect(r.degraded).toEqual(["approval-store: timeout"]);
  });
});
