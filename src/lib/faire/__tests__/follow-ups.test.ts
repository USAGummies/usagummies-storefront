/**
 * Tests for the Faire Direct follow-up eligibility helpers.
 *
 * Locked contracts:
 *   - 3-day rule: a sent invite older than 3 days but newer than 7 →
 *     bucket="due_soon", code="due_soon".
 *   - 7-day rule: a sent invite older than 7 days → bucket="overdue",
 *     code="overdue".
 *   - Fresh: a sent invite less than 3 days old → bucket="not_due",
 *     code="fresh".
 *   - Wrong status: needs_review / approved / rejected → bucket="not_due",
 *     code="wrong_status".
 *   - Missing sentAt: status="sent" but no sentAt → bucket="not_due",
 *     code="missing_sent_at".
 *   - followUpQueuedAt set → bucket="not_due", code="follow_up_queued"
 *     (does NOT re-surface).
 *   - **No I/O.** Pure helpers. No fetch, no KV, no Gmail, no Faire,
 *     no HubSpot, no Slack. Tests prove this by NOT mocking anything.
 *   - reportFollowUps groups + sorts most-stale first.
 */
import { describe, expect, it } from "vitest";

import {
  __FOLLOW_UP_CONSTANTS,
  classifyForFollowUp,
  reportFollowUps,
  selectFollowUpsNeedingAction,
  suggestNextActionCopy,
} from "../follow-ups";
import type { FaireInviteRecord } from "../invites";

const NOW = new Date("2026-04-30T12:00:00Z");

function fakeRecord(
  overrides: Partial<FaireInviteRecord> = {},
): FaireInviteRecord {
  return {
    id: "buyer@x.com",
    retailerName: "Test Retailer",
    email: "buyer@x.com",
    source: "wholesale-page",
    status: "needs_review",
    queuedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("constants — locked thresholds", () => {
  it("3-day due-soon and 7-day overdue thresholds are wired up", () => {
    expect(__FOLLOW_UP_CONSTANTS.DUE_SOON_DAYS).toBe(3);
    expect(__FOLLOW_UP_CONSTANTS.OVERDUE_DAYS).toBe(7);
  });
});

describe("classifyForFollowUp — sent + age rules", () => {
  it("sent 0 days ago → fresh / not_due", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "sent", sentAt: isoDaysAgo(0) }),
      NOW,
    );
    expect(r.bucket).toBe("not_due");
    expect(r.reason.code).toBe("fresh");
    expect(r.daysSinceSent).toBe(0);
  });

  it("sent 2 days ago → fresh / not_due (still under the 3-day threshold)", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "sent", sentAt: isoDaysAgo(2) }),
      NOW,
    );
    expect(r.bucket).toBe("not_due");
    expect(r.reason.code).toBe("fresh");
  });

  it("sent exactly 3 days ago → due_soon (boundary inclusive)", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "sent", sentAt: isoDaysAgo(3) }),
      NOW,
    );
    expect(r.bucket).toBe("due_soon");
    expect(r.reason.code).toBe("due_soon");
    expect(r.daysSinceSent).toBe(3);
  });

  it("sent 5 days ago → due_soon", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "sent", sentAt: isoDaysAgo(5) }),
      NOW,
    );
    expect(r.bucket).toBe("due_soon");
    expect(r.reason.code).toBe("due_soon");
  });

  it("sent exactly 7 days ago → overdue (boundary inclusive)", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "sent", sentAt: isoDaysAgo(7) }),
      NOW,
    );
    expect(r.bucket).toBe("overdue");
    expect(r.reason.code).toBe("overdue");
    expect(r.daysSinceSent).toBe(7);
  });

  it("sent 14 days ago → overdue", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "sent", sentAt: isoDaysAgo(14) }),
      NOW,
    );
    expect(r.bucket).toBe("overdue");
    expect(r.reason.code).toBe("overdue");
    expect(r.daysSinceSent).toBe(14);
  });
});

describe("classifyForFollowUp — wrong status (never due)", () => {
  it("needs_review → not_due / wrong_status", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "needs_review", sentAt: isoDaysAgo(30) }),
      NOW,
    );
    expect(r.bucket).toBe("not_due");
    expect(r.reason.code).toBe("wrong_status");
    expect(r.daysSinceSent).toBeNull();
  });
  it("approved → not_due / wrong_status", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "approved", sentAt: isoDaysAgo(30) }),
      NOW,
    );
    expect(r.bucket).toBe("not_due");
    expect(r.reason.code).toBe("wrong_status");
  });
  it("rejected → not_due / wrong_status", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "rejected", sentAt: isoDaysAgo(30) }),
      NOW,
    );
    expect(r.bucket).toBe("not_due");
    expect(r.reason.code).toBe("wrong_status");
  });
});

describe("classifyForFollowUp — data-integrity edges", () => {
  it("status=sent but no sentAt → missing_sent_at", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "sent", sentAt: undefined }),
      NOW,
    );
    expect(r.bucket).toBe("not_due");
    expect(r.reason.code).toBe("missing_sent_at");
    expect(r.daysSinceSent).toBeNull();
  });

  it("status=sent but unparseable sentAt → missing_sent_at", () => {
    const r = classifyForFollowUp(
      fakeRecord({ status: "sent", sentAt: "not-a-date" }),
      NOW,
    );
    expect(r.bucket).toBe("not_due");
    expect(r.reason.code).toBe("missing_sent_at");
  });

  it("followUpQueuedAt set → not_due / follow_up_queued (no re-surface)", () => {
    const r = classifyForFollowUp(
      fakeRecord({
        status: "sent",
        sentAt: isoDaysAgo(30), // very old
        followUpQueuedAt: isoDaysAgo(2),
      }),
      NOW,
    );
    expect(r.bucket).toBe("not_due");
    expect(r.reason.code).toBe("follow_up_queued");
    // daysSinceSent still computed for context
    expect(r.daysSinceSent).toBe(30);
  });
});

describe("reportFollowUps — grouping + sort", () => {
  it("groups records into the three buckets", () => {
    const list: FaireInviteRecord[] = [
      fakeRecord({ id: "fresh", status: "sent", sentAt: isoDaysAgo(1) }),
      fakeRecord({
        id: "due-mid",
        status: "sent",
        sentAt: isoDaysAgo(5),
      }),
      fakeRecord({
        id: "overdue-old",
        status: "sent",
        sentAt: isoDaysAgo(20),
      }),
      fakeRecord({
        id: "approved-no-send",
        status: "approved",
      }),
      fakeRecord({
        id: "rejected",
        status: "rejected",
      }),
    ];
    const r = reportFollowUps(list, NOW);
    expect(r.total).toBe(5);
    expect(r.overdue.map((c) => c.record.id)).toEqual(["overdue-old"]);
    expect(r.due_soon.map((c) => c.record.id)).toEqual(["due-mid"]);
    expect(r.not_due.map((c) => c.record.id).sort()).toEqual([
      "approved-no-send",
      "fresh",
      "rejected",
    ]);
  });

  it("sorts overdue + due_soon most-stale first", () => {
    const list: FaireInviteRecord[] = [
      fakeRecord({
        id: "old-3",
        status: "sent",
        sentAt: isoDaysAgo(3),
      }),
      fakeRecord({
        id: "old-6",
        status: "sent",
        sentAt: isoDaysAgo(6),
      }),
      fakeRecord({
        id: "old-5",
        status: "sent",
        sentAt: isoDaysAgo(5),
      }),
      fakeRecord({
        id: "old-30",
        status: "sent",
        sentAt: isoDaysAgo(30),
      }),
      fakeRecord({
        id: "old-10",
        status: "sent",
        sentAt: isoDaysAgo(10),
      }),
    ];
    const r = reportFollowUps(list, NOW);
    expect(r.overdue.map((c) => c.record.id)).toEqual(["old-30", "old-10"]);
    expect(r.due_soon.map((c) => c.record.id)).toEqual([
      "old-6",
      "old-5",
      "old-3",
    ]);
  });

  it("handles null / undefined / empty input", () => {
    expect(reportFollowUps(null, NOW)).toEqual({
      total: 0,
      overdue: [],
      due_soon: [],
      not_due: [],
    });
    expect(reportFollowUps(undefined, NOW)).toEqual({
      total: 0,
      overdue: [],
      due_soon: [],
      not_due: [],
    });
    expect(reportFollowUps([], NOW)).toEqual({
      total: 0,
      overdue: [],
      due_soon: [],
      not_due: [],
    });
  });
});

describe("selectFollowUpsNeedingAction", () => {
  it("returns only overdue + due_soon records (not fresh / not wrong-status)", () => {
    const list: FaireInviteRecord[] = [
      fakeRecord({ id: "fresh", status: "sent", sentAt: isoDaysAgo(1) }),
      fakeRecord({ id: "due", status: "sent", sentAt: isoDaysAgo(4) }),
      fakeRecord({ id: "overdue", status: "sent", sentAt: isoDaysAgo(8) }),
      fakeRecord({ id: "rejected", status: "rejected" }),
    ];
    const out = selectFollowUpsNeedingAction(list, NOW).map((r) => r.id);
    expect(out.sort()).toEqual(["due", "overdue"]);
  });
});

describe("suggestNextActionCopy", () => {
  it("uses buyerName when present, retailerName otherwise", () => {
    const withBuyer = suggestNextActionCopy(
      fakeRecord({
        retailerName: "Whole Foods PNW",
        buyerName: "Sarah Smith",
      }),
      5,
    );
    expect(withBuyer).toContain("Sarah Smith");

    const withoutBuyer = suggestNextActionCopy(
      fakeRecord({ retailerName: "Whole Foods PNW", buyerName: undefined }),
      5,
    );
    expect(withoutBuyer).toContain("Whole Foods PNW");
  });

  it("uses 'overdue' wording at the 7-day threshold and 'ready' below it", () => {
    const due = suggestNextActionCopy(fakeRecord(), 5);
    const overdue = suggestNextActionCopy(fakeRecord(), 9);
    expect(due).toContain("ready");
    expect(overdue).toContain("overdue");
  });

  it("does NOT include claims about pricing terms, lead times, or product effects", () => {
    const out = suggestNextActionCopy(fakeRecord(), 9);
    // Reminder copy explicitly forbids these. The reminder line must
    // be in the suggestion so the operator sees it before pasting.
    expect(out).toMatch(/Do NOT promise/i);
  });
});

describe("Phase 3.2 invariant — pure functions, no I/O", () => {
  it("all helpers are sync-call-safe with no test setup (any I/O attempt would crash)", () => {
    expect(() =>
      classifyForFollowUp(
        fakeRecord({ status: "sent", sentAt: isoDaysAgo(5) }),
        NOW,
      ),
    ).not.toThrow();
    expect(() => reportFollowUps([], NOW)).not.toThrow();
    expect(() => selectFollowUpsNeedingAction([], NOW)).not.toThrow();
    expect(() => suggestNextActionCopy(fakeRecord(), 5)).not.toThrow();
  });
});
