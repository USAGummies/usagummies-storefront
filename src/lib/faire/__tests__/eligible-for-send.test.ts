/**
 * Tests for the pure eligibility helpers.
 *
 * Locked contracts:
 *   - Only `status === "approved"` is eligible.
 *   - Records that fail re-validation (drifted fields) are excluded
 *     with `code: "validation_failed"`.
 *   - `needs_review` / `rejected` / `sent` records are excluded with
 *     `code: "wrong_status"`.
 *   - `summarizeForApproval` never echoes `reviewedBy`, internal id,
 *     full unbounded notes, or any field beyond the explicitly-listed
 *     summary lines. Notes truncated at 160 chars.
 *   - No I/O, no fetch, no KV.
 */
import { describe, expect, it } from "vitest";

import type { FaireInviteRecord } from "../invites";
import {
  classifyForSend,
  reportEligibility,
  selectApprovedInviteCandidates,
  summarizeForApproval,
} from "../eligible-for-send";

const NOW = "2026-04-29T12:00:00Z";

function fakeRecord(
  overrides: Partial<FaireInviteRecord> = {},
): FaireInviteRecord {
  return {
    id: "buyer@x.com",
    retailerName: "Test Retailer",
    email: "buyer@x.com",
    source: "wholesale-page",
    status: "needs_review",
    queuedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("classifyForSend", () => {
  it("approved + valid → eligible", () => {
    const r = classifyForSend(fakeRecord({ status: "approved" }));
    expect(r.eligible).toBe(true);
    expect(r.reason.code).toBe("ok");
  });

  it("needs_review → wrong_status", () => {
    const r = classifyForSend(fakeRecord({ status: "needs_review" }));
    expect(r.eligible).toBe(false);
    expect(r.reason.code).toBe("wrong_status");
    expect(r.reason.detail).toContain("needs_review");
  });

  it("rejected → wrong_status", () => {
    const r = classifyForSend(fakeRecord({ status: "rejected" }));
    expect(r.eligible).toBe(false);
    expect(r.reason.code).toBe("wrong_status");
  });

  it("sent → wrong_status (already terminal)", () => {
    const r = classifyForSend(fakeRecord({ status: "sent" }));
    expect(r.eligible).toBe(false);
    expect(r.reason.code).toBe("wrong_status");
  });

  it("approved but email drifted to invalid → validation_failed", () => {
    const r = classifyForSend(
      fakeRecord({ status: "approved", email: "broken-email" }),
    );
    expect(r.eligible).toBe(false);
    expect(r.reason.code).toBe("validation_failed");
    expect(r.reason.detail).toMatch(/needs_review/i); // copy nudges operator to fix
  });

  it("approved but retailerName cleared → validation_failed", () => {
    const r = classifyForSend(
      fakeRecord({ status: "approved", retailerName: "" }),
    );
    expect(r.eligible).toBe(false);
    expect(r.reason.code).toBe("validation_failed");
  });

  it("approved but source cleared → validation_failed", () => {
    const r = classifyForSend(
      fakeRecord({ status: "approved", source: "" }),
    );
    expect(r.eligible).toBe(false);
    expect(r.reason.code).toBe("validation_failed");
  });
});

describe("selectApprovedInviteCandidates", () => {
  it("returns only the approved + valid records", () => {
    const list: FaireInviteRecord[] = [
      fakeRecord({ id: "a", email: "a@x.com", status: "needs_review" }),
      fakeRecord({ id: "b", email: "b@x.com", status: "approved" }),
      fakeRecord({ id: "c", email: "c@x.com", status: "rejected" }),
      fakeRecord({ id: "d", email: "d@x.com", status: "sent" }),
      fakeRecord({ id: "e", email: "e@x.com", status: "approved" }),
    ];
    const out = selectApprovedInviteCandidates(list);
    expect(out.map((r) => r.id).sort()).toEqual(["b", "e"]);
  });

  it("excludes approved-but-drifted records (validation_failed)", () => {
    const list: FaireInviteRecord[] = [
      fakeRecord({ id: "ok", email: "ok@x.com", status: "approved" }),
      fakeRecord({
        id: "broken",
        email: "not-an-email",
        status: "approved",
      }),
    ];
    const out = selectApprovedInviteCandidates(list);
    expect(out.map((r) => r.id)).toEqual(["ok"]);
  });

  it("returns empty array for null / undefined / empty input", () => {
    expect(selectApprovedInviteCandidates(null)).toEqual([]);
    expect(selectApprovedInviteCandidates(undefined)).toEqual([]);
    expect(selectApprovedInviteCandidates([])).toEqual([]);
  });
});

describe("reportEligibility", () => {
  it("splits the queue into eligible + ineligible buckets with reasons", () => {
    const list: FaireInviteRecord[] = [
      fakeRecord({ id: "a", email: "a@x.com", status: "approved" }),
      fakeRecord({ id: "b", email: "b@x.com", status: "needs_review" }),
      fakeRecord({
        id: "c",
        email: "broken-email",
        status: "approved",
      }),
    ];
    const r = reportEligibility(list);
    expect(r.total).toBe(3);
    expect(r.eligible.map((x) => x.id)).toEqual(["a"]);
    const ineligible = r.ineligible
      .map((x) => ({ id: x.record.id, code: x.reason.code }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(ineligible).toEqual([
      { id: "b", code: "wrong_status" },
      { id: "c", code: "validation_failed" },
    ]);
  });

  it("handles empty input", () => {
    expect(reportEligibility([])).toEqual({
      total: 0,
      eligible: [],
      ineligible: [],
    });
  });
});

describe("summarizeForApproval — scrubbed preview string", () => {
  it("includes the operator-typed fields the approver needs to decide", () => {
    const out = summarizeForApproval(
      fakeRecord({
        retailerName: "Whole Foods Market",
        email: "ap@wholefoods.com",
        buyerName: "Sarah Smith",
        city: "Portland",
        state: "OR",
        source: "trade-show-2026",
        notes: "Met at Expo West. Wants 6-pack mailers.",
      }),
    );
    expect(out).toContain("Whole Foods Market");
    expect(out).toContain("ap@wholefoods.com");
    expect(out).toContain("Sarah Smith");
    expect(out).toContain("Portland, OR");
    expect(out).toContain("trade-show-2026");
    expect(out).toContain("Met at Expo West");
  });

  it("never echoes reviewedBy (operator email/PII)", () => {
    const out = summarizeForApproval(
      fakeRecord({
        reviewedBy: "rene@usagummies.com",
        reviewNote: "approved by Rene",
      }),
    );
    expect(out).not.toContain("rene@usagummies.com");
    expect(out).not.toContain("approved by Rene");
  });

  it("never includes lifecycle metadata (queuedAt / updatedAt / reviewedAt / status)", () => {
    // Note: the record's `id` happens to equal `email` by design (the
    // dedup key derives from email). The email IS surfaced — that's
    // the operator-facing claim. The test here is about lifecycle
    // metadata + Slack-internal ids, not about the email.
    const r = fakeRecord({
      id: "buyer@x.com",
      email: "buyer@x.com",
      status: "approved",
      reviewedAt: "2026-04-29T13:00:00Z",
    });
    const out = summarizeForApproval(r);
    expect(out).not.toContain(r.queuedAt);
    expect(out).not.toContain(r.updatedAt);
    expect(out).not.toContain(r.reviewedAt as string);
    expect(out).not.toContain("status:");
  });

  it("truncates notes longer than 160 chars with an ellipsis", () => {
    const long = "x".repeat(500);
    const out = summarizeForApproval(fakeRecord({ notes: long }));
    expect(out).toContain("…");
    expect(out.length).toBeLessThan(500);
  });

  it("omits optional lines when fields are absent", () => {
    const out = summarizeForApproval(
      fakeRecord({
        buyerName: undefined,
        city: undefined,
        state: undefined,
        notes: undefined,
      }),
    );
    expect(out).not.toContain("Buyer:");
    expect(out).not.toContain("Location:");
    expect(out).not.toContain("Notes:");
    expect(out).toContain("Source:");
  });
});

describe("Phase 3 first-step invariant — no I/O", () => {
  it("module exports are pure functions; calling them never throws on the standard shape", () => {
    // Pure-helper smoke test: no test setup, no kv mock, no fetch
    // mock — any I/O attempt would crash here.
    expect(() => summarizeForApproval(fakeRecord())).not.toThrow();
    expect(() => classifyForSend(fakeRecord())).not.toThrow();
    expect(() => selectApprovedInviteCandidates([])).not.toThrow();
    expect(() => reportEligibility([])).not.toThrow();
  });
});
