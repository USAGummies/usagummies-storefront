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
  derivePromoteReviewPill,
  type PromoteReviewState,
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

// ---------------------------------------------------------------------------
// Phase 11 — derivePromoteReviewPill (per-receipt button feedback)
// ---------------------------------------------------------------------------

describe("derivePromoteReviewPill — Phase 11 button state", () => {
  it("idle → neutral pill inviting the operator to click", () => {
    const p = derivePromoteReviewPill({ kind: "idle" });
    expect(p.variant).toBe("idle");
    expect(p.color).toBe("neutral");
    expect(p.label).toMatch(/Request Rene review/i);
    expect(p.detail).toBe("");
  });

  it("loading → neutral pill with muted copy", () => {
    const p = derivePromoteReviewPill({ kind: "loading" });
    expect(p.variant).toBe("loading");
    expect(p.color).toBe("neutral");
    expect(p.label).toMatch(/requesting/i);
    expect(p.detail).toBe("");
  });

  it("opened → green pill with truncated approval id + status + approvers", () => {
    const p = derivePromoteReviewPill({
      kind: "opened",
      approvalId: "abcdef12-3456-7890-abcd-ef1234567890",
      status: "pending",
      requiredApprovers: ["Rene"],
    });
    expect(p.variant).toBe("opened");
    expect(p.color).toBe("green");
    expect(p.label).toMatch(/Approval opened/);
    expect(p.label).toContain("pending");
    // Truncated id (first 8 chars) — locks the no-PII / scannable contract.
    expect(p.detail).toContain("abcdef12");
    expect(p.detail).toContain("Rene");
  });

  it("opened with no approvers (defensive) → '(none)' instead of empty string", () => {
    const p = derivePromoteReviewPill({
      kind: "opened",
      approvalId: "12345678-aaaa-bbbb-cccc-dddddddddddd",
      status: "pending",
      requiredApprovers: [],
    });
    expect(p.detail).toContain("(none)");
  });

  it("draft-only → amber pill carrying the route's verbatim reason", () => {
    const p = derivePromoteReviewPill({
      kind: "draft-only",
      reason:
        "Packet ineligible — missing fields: vendor, date, amount, category.",
    });
    expect(p.variant).toBe("draft-only");
    expect(p.color).toBe("amber");
    expect(p.label).toMatch(/Draft packet only/);
    // Reason surfaced verbatim — no rewriting / paraphrase.
    expect(p.detail).toBe(
      "Packet ineligible — missing fields: vendor, date, amount, category.",
    );
  });

  it("draft-only with explicit missing[] appends the field list to the detail", () => {
    const p = derivePromoteReviewPill({
      kind: "draft-only",
      reason: "Packet ineligible — missing fields.",
      missing: ["vendor", "amount"],
    });
    expect(p.detail).toContain("Packet ineligible");
    expect(p.detail).toContain("missing: vendor, amount");
  });

  it("draft-only with empty missing[] does NOT add a stray '· missing:' suffix", () => {
    const p = derivePromoteReviewPill({
      kind: "draft-only",
      reason: "Taxonomy slug null.",
      missing: [],
    });
    expect(p.detail).toBe("Taxonomy slug null.");
    expect(p.detail).not.toContain("missing:");
  });

  it("error → red pill with the underlying error verbatim", () => {
    const p = derivePromoteReviewPill({
      kind: "error",
      reason: "HTTP 503 Service Unavailable",
    });
    expect(p.variant).toBe("error");
    expect(p.color).toBe("red");
    expect(p.label).toMatch(/failed/i);
    expect(p.detail).toBe("HTTP 503 Service Unavailable");
  });

  it("never paraphrases or 'softens' a reason — operator sees the real cause", () => {
    // Locked invariant: if the route says ECONNREFUSED, the pill shows
    // ECONNREFUSED — not "Couldn't reach service" or similar. This
    // matches the wider blueprint rule on transparent failure surfaces.
    const cause = "kv_read_failed: ECONNREFUSED";
    const errorPill = derivePromoteReviewPill({ kind: "error", reason: cause });
    expect(errorPill.detail).toBe(cause);
    const draftPill = derivePromoteReviewPill({
      kind: "draft-only",
      reason: cause,
    });
    expect(draftPill.detail).toBe(cause);
  });

  it("output is deterministic for the same input (pure)", () => {
    const state: PromoteReviewState = {
      kind: "opened",
      approvalId: "abc12345-1111-2222-3333-444444444444",
      status: "pending",
      requiredApprovers: ["Rene"],
    };
    expect(derivePromoteReviewPill(state)).toEqual(
      derivePromoteReviewPill(state),
    );
  });

  // ---- Phase 12 — permalink + packetStatus -------------------------------

  it("opened with no permalink → pill.permalink is null (NEVER fabricated)", () => {
    const p = derivePromoteReviewPill({
      kind: "opened",
      approvalId: "abc12345-1111-2222-3333-444444444444",
      status: "pending",
      requiredApprovers: ["Rene"],
    });
    expect(p.permalink).toBeNull();
  });

  it("opened with permalink → pill carries it verbatim", () => {
    const url =
      "https://usagummies.slack.com/archives/C0ALS6W7VB4/p1700000000000123";
    const p = derivePromoteReviewPill({
      kind: "opened",
      approvalId: "abc12345-1111-2222-3333-444444444444",
      status: "pending",
      requiredApprovers: ["Rene"],
      permalink: url,
    });
    expect(p.permalink).toBe(url);
  });

  it("opened with empty-string permalink → pill.permalink is null (defensive)", () => {
    const p = derivePromoteReviewPill({
      kind: "opened",
      approvalId: "abc12345-1111-2222-3333-444444444444",
      status: "pending",
      requiredApprovers: ["Rene"],
      permalink: "",
    });
    expect(p.permalink).toBeNull();
  });

  it("packetStatus = 'rene-approved' → label flips to 'Rene approved' + green", () => {
    const p = derivePromoteReviewPill({
      kind: "opened",
      approvalId: "abc12345-1111-2222-3333-444444444444",
      status: "approved",
      requiredApprovers: ["Rene"],
      packetStatus: "rene-approved",
    });
    expect(p.label).toBe("Rene approved");
    expect(p.color).toBe("green");
  });

  it("packetStatus = 'rejected' → label flips to 'Rene rejected' + amber (visible gap signal)", () => {
    const p = derivePromoteReviewPill({
      kind: "opened",
      approvalId: "abc12345-1111-2222-3333-444444444444",
      status: "rejected",
      requiredApprovers: ["Rene"],
      packetStatus: "rejected",
    });
    expect(p.label).toBe("Rene rejected");
    expect(p.color).toBe("amber");
  });

  it("packetStatus = 'draft' (pre-decision) → label still 'Approval opened · pending'", () => {
    const p = derivePromoteReviewPill({
      kind: "opened",
      approvalId: "abc12345-1111-2222-3333-444444444444",
      status: "pending",
      requiredApprovers: ["Rene"],
      packetStatus: "draft",
    });
    expect(p.label).toMatch(/Approval opened/);
    expect(p.color).toBe("green");
  });

  it("non-opened states never carry a permalink (pill.permalink is undefined)", () => {
    expect(derivePromoteReviewPill({ kind: "idle" }).permalink).toBeUndefined();
    expect(
      derivePromoteReviewPill({ kind: "loading" }).permalink,
    ).toBeUndefined();
    expect(
      derivePromoteReviewPill({
        kind: "draft-only",
        reason: "x",
      }).permalink,
    ).toBeUndefined();
    expect(
      derivePromoteReviewPill({ kind: "error", reason: "x" }).permalink,
    ).toBeUndefined();
  });
});
