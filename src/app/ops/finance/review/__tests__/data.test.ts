/**
 * Pure unit tests for the Finance Review data-shaping helpers.
 *
 * These tests lock the contract that the surface NEVER fabricates data:
 *   - empty queue → "empty" wiring (not "wired" with zero count)
 *   - error → surfaces the error string, not zeros
 *   - null payload → "error", not "wired"
 *   - the Monday action list ordering is by priority (urgent first)
 */
import { describe, expect, it } from "vitest";

import {
  buildMondayActionList,
  deriveApPacketsStatus,
  deriveApprovalsStatus,
  deriveFreightStatus,
  deriveReceiptStatus,
} from "../data";

describe("deriveReceiptStatus", () => {
  it("error path returns wiring=error and the message", () => {
    const s = deriveReceiptStatus(null, "kv unreachable");
    expect(s.wiring).toBe("error");
    expect(s.error).toBe("kv unreachable");
  });
  it("null payload without error is also treated as error (no fabrication)", () => {
    const s = deriveReceiptStatus(null, null);
    expect(s.wiring).toBe("error");
  });
  it("empty queue is empty, not wired", () => {
    const s = deriveReceiptStatus(
      { ok: true, total_receipts: 0, needs_review: 0, ready: 0, total_amount: 0 },
      null,
    );
    expect(s.wiring).toBe("empty");
    expect(s.label).toMatch(/No receipts/i);
  });
  it("populated queue is wired with the count summary", () => {
    const s = deriveReceiptStatus(
      {
        ok: true,
        total_receipts: 12,
        needs_review: 5,
        ready: 7,
        total_amount: 432.21,
      },
      null,
    );
    expect(s.wiring).toBe("wired");
    expect(s.label).toContain("5 need review");
    expect(s.label).toContain("7 ready");
    expect(s.label).toContain("$432.21");
  });
});

describe("deriveApprovalsStatus", () => {
  it("returns wired with count when approvals are pending", () => {
    const s = deriveApprovalsStatus(
      {
        ok: true,
        approvals: [
          {
            id: "a1",
            action: "Create vendor master",
            actorAgentId: "vendor-onboarding",
            status: "pending",
            class: "B",
            requiredApprovers: ["Rene"],
            createdAt: "2026-04-25T01:00:00Z",
          },
        ],
      },
      null,
    );
    expect(s.wiring).toBe("wired");
    expect(s.label).toMatch(/1 pending/);
  });
  it("empty array → empty wiring with 0 pending label", () => {
    const s = deriveApprovalsStatus({ ok: true, approvals: [] }, null);
    expect(s.wiring).toBe("empty");
    expect(s.label).toMatch(/0 pending/);
  });
  it("upstream error surfaces", () => {
    const s = deriveApprovalsStatus(null, "503 circuit open");
    expect(s.wiring).toBe("error");
    expect(s.error).toMatch(/circuit/i);
  });
});

describe("deriveFreightStatus", () => {
  it("queue empty → wiring=empty", () => {
    const s = deriveFreightStatus(
      { ok: true, total: 0, totals: { queued: 0, queuedDollars: 0 } },
      null,
    );
    expect(s.wiring).toBe("empty");
  });
  it("queued items → wired with dollars", () => {
    const s = deriveFreightStatus(
      {
        ok: true,
        total: 3,
        totals: { queued: 3, queuedDollars: 142.5 },
      },
      null,
    );
    expect(s.wiring).toBe("wired");
    expect(s.label).toContain("3 queued");
    expect(s.label).toContain("$142.50");
  });
});

describe("deriveApPacketsStatus", () => {
  it("no packets → empty wiring", () => {
    const s = deriveApPacketsStatus({ ok: true, packets: [] }, null);
    expect(s.wiring).toBe("empty");
  });
  it("packets with no review flags → wired/all current", () => {
    const s = deriveApPacketsStatus(
      {
        ok: true,
        packets: [
          { slug: "jj", accountName: "Jungle Jim's", status: "ready" },
          { slug: "wfm", accountName: "Whole Foods", status: "ready" },
        ],
      },
      null,
    );
    expect(s.wiring).toBe("wired");
    expect(s.label).toContain("pricing all current");
  });
  it("flag set on at least one → wired with review count", () => {
    const s = deriveApPacketsStatus(
      {
        ok: true,
        packets: [
          { slug: "jj", accountName: "Jungle Jim's", status: "ready" },
          {
            slug: "wfm",
            accountName: "Whole Foods",
            status: "ready",
            pricingNeedsReview: true,
          },
        ],
      },
      null,
    );
    expect(s.wiring).toBe("wired");
    expect(s.label).toContain("1 need pricing review");
  });
});

describe("buildMondayActionList", () => {
  it("sorts items by priority (urgent first)", () => {
    const list = buildMondayActionList({
      receipts: { ok: true, total_receipts: 3, needs_review: 3, ready: 0, total_amount: 0 },
      approvals: {
        ok: true,
        approvals: [
          {
            id: "a1",
            action: "Create vendor master",
            actorAgentId: "vendor-onboarding",
            status: "pending",
            class: "B",
            requiredApprovers: ["Rene"],
            createdAt: "2026-04-25T01:00:00Z",
          },
        ],
      },
      freight: { ok: true, total: 1, totals: { queued: 1, queuedDollars: 12 } },
      apPackets: { ok: true, packets: [] },
      receiptsErr: null,
      approvalsErr: null,
      freightErr: null,
      apPacketsErr: null,
    });
    expect(list[0].id).toBe("receipts-needs-review"); // priority 100
    expect(list[1].id).toBe("approvals-pending"); // priority 90
    expect(list[2].id).toBe("freight-comp-queued"); // priority 80
    expect(list[3].id).toBe("ap-packets-review"); // priority 5 (empty)
  });

  it("error in one source does not zero out the others", () => {
    const list = buildMondayActionList({
      receipts: { ok: true, total_receipts: 0, needs_review: 0, ready: 0, total_amount: 0 },
      approvals: null,
      freight: { ok: true, total: 0, totals: { queued: 0, queuedDollars: 0 } },
      apPackets: { ok: true, packets: [] },
      receiptsErr: null,
      approvalsErr: "503 circuit open",
      freightErr: null,
      apPacketsErr: null,
    });
    const approvalsItem = list.find((i) => i.id === "approvals-pending")!;
    expect(approvalsItem.status).toBe("error");
    expect(approvalsItem.detail).toMatch(/circuit/i);
    // Other items unaffected
    const receiptsItem = list.find((i) => i.id === "receipts-needs-review")!;
    expect(receiptsItem.status).toBe("empty");
  });

  it("never fabricates a count when the source errored — count stays 0", () => {
    const list = buildMondayActionList({
      receipts: null,
      approvals: null,
      freight: null,
      apPackets: null,
      receiptsErr: "x",
      approvalsErr: "y",
      freightErr: "z",
      apPacketsErr: "w",
    });
    for (const item of list) {
      expect(item.status).toBe("error");
      expect(item.count).toBe(0);
    }
  });
});
