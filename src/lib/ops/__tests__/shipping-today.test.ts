/**
 * Shipping Today aggregator coverage — Build 2 close-out.
 *
 * Pins:
 *   - Retry queue counts (pending / exhausted) + 3 oldest pending.
 *   - Pending shipping approvals filtered to production-supply-chain.
 *   - Wallet alerts fire when balance < threshold (default $25).
 *   - Wallet fetch error (balanceUsd=null) downgrades posture to yellow.
 *   - Posture: red on exhausted retry / wallet alert / stale approval;
 *              yellow on work waiting; green on clean.
 *   - Degraded passthrough.
 */
import { describe, expect, it } from "vitest";

import { summarizeShippingToday } from "../shipping-today";
import type { DispatchRetryEntry } from "../dispatch-retry-queue";
import type {
  ApprovalRequest,
  DivisionId,
} from "../control-plane/types";

const NOW = new Date("2026-05-02T18:00:00Z");

function entry(
  overrides: Partial<DispatchRetryEntry> = {},
): DispatchRetryEntry {
  return {
    enqueuedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    reason: "slack-post: not_in_channel",
    intent: {} as never,
    classification: {} as never,
    proposal: {} as never,
    attempts: 1,
    status: "pending",
    ...overrides,
  } as DispatchRetryEntry;
}

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "a-1",
    runId: "run-1",
    division: "production-supply-chain" as DivisionId,
    actorAgentId: "ops",
    class: "B",
    action: "shipment.create",
    targetSystem: "shipstation",
    payloadPreview: "x",
    evidence: { claim: "x", sources: [], confidence: 0.9 },
    rollbackPlan: "x",
    requiredApprovers: ["Ben"] as never,
    status: "pending" as never,
    createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
    decisions: [],
    escalateAt: new Date(NOW.getTime() + 22 * 3600 * 1000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 70 * 3600 * 1000).toISOString(),
    ...overrides,
  };
}

describe("summarizeShippingToday — retry queue", () => {
  it("counts pending + exhausted separately", () => {
    const r = summarizeShippingToday({
      retryQueue: [
        entry({ status: "pending" }),
        entry({ status: "pending" }),
        entry({ status: "exhausted" }),
        entry({ status: "posted" }),
      ],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.retryQueue.pending).toBe(2);
    expect(r.retryQueue.exhausted).toBe(1);
    expect(r.retryQueue.total).toBe(4);
  });

  it("returns 3 oldest pending with attempts + ageMinutes", () => {
    const arr: DispatchRetryEntry[] = [];
    for (let i = 0; i < 5; i++) {
      arr.push(
        entry({
          enqueuedAt: new Date(
            NOW.getTime() - (i + 1) * 60_000,
          ).toISOString(),
          attempts: i + 1,
        }),
      );
    }
    const r = summarizeShippingToday({
      retryQueue: arr,
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.retryQueue.oldestPending).toHaveLength(3);
    expect(r.retryQueue.oldestPending[0].attempts).toBe(5); // oldest first
    expect(r.retryQueue.oldestPending[0].ageMinutes).toBe(5);
  });

  it("oldestPending excludes exhausted entries", () => {
    const r = summarizeShippingToday({
      retryQueue: [entry({ status: "exhausted" }), entry({ status: "pending" })],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.retryQueue.oldestPending).toHaveLength(1);
  });
});

describe("summarizeShippingToday — approvals", () => {
  it("filters to production-supply-chain division only", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [
        approval({ id: "ship", division: "production-supply-chain" as DivisionId }),
        approval({ id: "fin", division: "financials" as DivisionId }),
      ],
      now: NOW,
    });
    expect(r.pendingApprovals).toBe(1);
    expect(r.oldestPendingApprovals[0].id).toBe("ship");
  });

  it("ageDays computed correctly", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [
        approval({
          createdAt: new Date(
            NOW.getTime() - 4 * 24 * 3600 * 1000,
          ).toISOString(),
        }),
      ],
      now: NOW,
    });
    expect(r.oldestPendingApprovals[0].ageDays).toBe(4);
  });
});

describe("summarizeShippingToday — wallet alerts", () => {
  it("flags balance below default threshold ($25)", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [],
      wallet: [
        { carrierCode: "stamps_com", balanceUsd: 15 },
        { carrierCode: "ups_walleted", balanceUsd: 100 },
      ],
      now: NOW,
    });
    expect(r.walletAlerts).toHaveLength(1);
    expect(r.walletAlerts[0].carrierCode).toBe("stamps_com");
  });

  it("respects custom threshold", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [],
      wallet: [{ carrierCode: "stamps_com", balanceUsd: 50 }],
      walletAlertThresholdUsd: 75,
      now: NOW,
    });
    expect(r.walletAlerts).toHaveLength(1);
  });

  it("null balance (fetch error) doesn't fire wallet alert", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [],
      wallet: [
        { carrierCode: "stamps_com", balanceUsd: null, fetchError: "500" },
      ],
      now: NOW,
    });
    expect(r.walletAlerts).toHaveLength(0);
  });
});

describe("summarizeShippingToday — posture", () => {
  it("green when nothing waiting + healthy wallets", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [],
      wallet: [{ carrierCode: "stamps_com", balanceUsd: 100 }],
      now: NOW,
    });
    expect(r.posture).toBe("green");
  });

  it("yellow when retries are pending", () => {
    const r = summarizeShippingToday({
      retryQueue: [entry({ status: "pending" })],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.posture).toBe("yellow");
  });

  it("yellow when wallet fetch failed (null balance)", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [],
      wallet: [
        {
          carrierCode: "stamps_com",
          balanceUsd: null,
          fetchError: "500",
        },
      ],
      now: NOW,
    });
    expect(r.posture).toBe("yellow");
  });

  it("red when an entry is exhausted", () => {
    const r = summarizeShippingToday({
      retryQueue: [entry({ status: "exhausted" })],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.posture).toBe("red");
  });

  it("red when wallet below threshold", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [],
      wallet: [{ carrierCode: "stamps_com", balanceUsd: 5 }],
      now: NOW,
    });
    expect(r.posture).toBe("red");
  });

  it("red when an approval is ≥3 days old", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [
        approval({
          createdAt: new Date(
            NOW.getTime() - 4 * 24 * 3600 * 1000,
          ).toISOString(),
        }),
      ],
      now: NOW,
    });
    expect(r.posture).toBe("red");
  });
});

describe("summarizeShippingToday — degraded passthrough", () => {
  it("forwards degraded list", () => {
    const r = summarizeShippingToday({
      retryQueue: [],
      pendingApprovals: [],
      degraded: ["wallet:500"],
      now: NOW,
    });
    expect(r.degraded).toEqual(["wallet:500"]);
  });
});
