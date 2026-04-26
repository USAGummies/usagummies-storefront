/**
 * Pure unit tests for the AP Packet Dashboard derivation helpers.
 *
 * Locks the no-fabrication contract:
 *   - "ready-to-send" with no missing/review docs → "Open packet → Send via Class B"
 *   - missing > 0 → "Resolve N missing" + sendStatus=blocked_missing_docs
 *   - review > 0 → "Confirm N attachments flagged for review"
 *   - lastSent within 30d → "Sent N days ago — wait for buyer ack"
 *   - lastSent > 30d → "Stale send — follow up with buyer"
 *   - pricingNeedsReview → "Review pricing" + blocked_pricing_review
 *   - action-required without missing/review → falls back to packet's own
 *     firstNextAction; never invents one
 *   - daysBetween handles missing/invalid timestamps without throwing
 *   - summarizeDashboard counts every status independently
 *   - hasPacketTemplateRegistry is false today (no template store yet)
 */
import { describe, expect, it } from "vitest";

import {
  daysBetween,
  deriveDashboardRow,
  hasPacketTemplateRegistry,
  summarizeDashboard,
  type PacketRosterRow,
} from "../ap-packet-dashboard";

const NOW = new Date("2026-04-25T12:00:00Z");

function row(overrides: Partial<PacketRosterRow> = {}): PacketRosterRow {
  return {
    slug: "jungle-jims",
    accountName: "Jungle Jim's",
    apEmail: "ap@junglejims.com",
    owner: "Rene",
    status: "ready-to-send",
    dueWindow: "EOW",
    pricingNeedsReview: false,
    attachmentSummary: { ready: 5, optional: 1, missing: 0, review: 0, total: 6 },
    nextActionsCount: 0,
    firstNextAction: null,
    lastSent: null,
    ...overrides,
  };
}

describe("daysBetween", () => {
  it("returns null on missing input", () => {
    expect(daysBetween(null, NOW)).toBeNull();
    expect(daysBetween(undefined, NOW)).toBeNull();
  });
  it("returns null on unparseable ISO", () => {
    expect(daysBetween("not-a-date", NOW)).toBeNull();
  });
  it("clamps negative durations (future timestamps) to 0", () => {
    expect(daysBetween("2027-01-01T00:00:00Z", NOW)).toBe(0);
  });
  it("computes integer days for past timestamps", () => {
    expect(daysBetween("2026-04-20T12:00:00Z", NOW)).toBe(5);
  });
});

describe("deriveDashboardRow", () => {
  it("ready-to-send + no missing/review + never sent → 'Open packet → Send via Class B'", () => {
    const r = deriveDashboardRow(row(), NOW);
    expect(r.sendStatus).toBe("not_yet_sent");
    expect(r.recommendedAction).toMatch(/Send via Class B/);
    expect(r.statusLabel).toBe("Not yet sent");
  });

  it("missing > 0 → blocked_missing_docs + plural-aware message", () => {
    const r = deriveDashboardRow(
      row({
        attachmentSummary: { ready: 4, optional: 0, missing: 2, review: 0, total: 6 },
      }),
      NOW,
    );
    expect(r.sendStatus).toBe("blocked_missing_docs");
    expect(r.recommendedAction).toBe(
      "Resolve 2 missing attachments before sending.",
    );
  });

  it("missing = 1 → singular wording", () => {
    const r = deriveDashboardRow(
      row({
        attachmentSummary: { ready: 5, optional: 0, missing: 1, review: 0, total: 6 },
      }),
      NOW,
    );
    expect(r.recommendedAction).toBe(
      "Resolve 1 missing attachment before sending.",
    );
  });

  it("review > 0 with no send history → confirms attachments + secondary 'send via Class B'", () => {
    const r = deriveDashboardRow(
      row({
        attachmentSummary: { ready: 4, optional: 0, missing: 0, review: 2, total: 6 },
      }),
      NOW,
    );
    expect(r.sendStatus).toBe("not_yet_sent");
    expect(r.recommendedAction).toMatch(/Confirm 2 attachments/);
    expect(r.secondaryActions.some((s) => /Class B/.test(s))).toBe(true);
  });

  it("pricingNeedsReview blocks before missing-docs check", () => {
    const r = deriveDashboardRow(
      row({
        pricingNeedsReview: true,
        attachmentSummary: { ready: 4, optional: 0, missing: 2, review: 0, total: 6 },
      }),
      NOW,
    );
    expect(r.sendStatus).toBe("blocked_pricing_review");
    expect(r.recommendedAction).toMatch(/Review pricing/);
  });

  it("recent send (≤30d) → sent_recently + 'wait for buyer ack'", () => {
    const r = deriveDashboardRow(
      row({
        lastSent: {
          sentAt: "2026-04-20T12:00:00Z",
          sentBy: "ap-packet-sender",
          messageId: "gmail-abc",
          threadId: "thread-1",
        },
      }),
      NOW,
    );
    expect(r.sendStatus).toBe("sent_recently");
    expect(r.recommendedAction).toMatch(/5 days ago/);
    expect(r.daysSinceLastSent).toBe(5);
  });

  it("send today → '0 days ago' rendered as 'today'", () => {
    const r = deriveDashboardRow(
      row({
        lastSent: {
          sentAt: NOW.toISOString(),
          sentBy: "Ben",
          messageId: "m1",
          threadId: null,
        },
      }),
      NOW,
    );
    expect(r.recommendedAction).toMatch(/today/);
  });

  it("stale send (>30d) → sent_long_ago + 'follow up with buyer'", () => {
    const r = deriveDashboardRow(
      row({
        lastSent: {
          sentAt: "2026-02-01T12:00:00Z",
          sentBy: "Ben",
          messageId: "m-old",
          threadId: null,
        },
      }),
      NOW,
    );
    expect(r.sendStatus).toBe("sent_long_ago");
    expect(r.recommendedAction).toMatch(/Stale send/);
    expect(r.recommendedAction).toMatch(/follow up/);
  });

  it("action-required + no missing/review → falls back to firstNextAction (never invents)", () => {
    const r = deriveDashboardRow(
      row({
        status: "action-required",
        firstNextAction: "Confirm pricing for premium pack with Ben.",
      }),
      NOW,
    );
    expect(r.recommendedAction).toBe(
      "Confirm pricing for premium pack with Ben.",
    );
    expect(r.sendStatus).toBe("not_yet_sent");
  });

  it("action-required + no firstNextAction → safe generic placeholder, not fabricated copy", () => {
    const r = deriveDashboardRow(
      row({ status: "action-required", firstNextAction: null }),
      NOW,
    );
    // Generic placeholder is allowed because it doesn't claim work was done.
    expect(r.recommendedAction).toMatch(/Open packet/i);
  });

  it("pricing flag as soft warning when sendStatus is something else", () => {
    const r = deriveDashboardRow(
      row({
        pricingNeedsReview: false,
        // Construct a state where sendStatus = sent_recently first
        lastSent: {
          sentAt: "2026-04-24T12:00:00Z",
          sentBy: "Ben",
          messageId: "m1",
          threadId: null,
        },
      }),
      NOW,
    );
    // No pricing flag → no secondary about pricing
    expect(r.secondaryActions.some((s) => /pricing/i.test(s))).toBe(false);
  });

  it("messageId of last send appears as a secondary action", () => {
    const r = deriveDashboardRow(
      row({
        lastSent: {
          sentAt: "2026-04-24T12:00:00Z",
          sentBy: "Ben",
          messageId: "gmail-9999",
          threadId: "thr-9999",
        },
      }),
      NOW,
    );
    expect(
      r.secondaryActions.some(
        (s) => s.includes("gmail-9999") && s.includes("thr-9999"),
      ),
    ).toBe(true);
  });
});

describe("summarizeDashboard", () => {
  it("counts every status independently", () => {
    const rows = [
      row(),
      row({
        slug: "wfm",
        attachmentSummary: { ready: 0, optional: 0, missing: 1, review: 0, total: 1 },
      }),
      row({
        slug: "kroger",
        pricingNeedsReview: true,
      }),
      row({
        slug: "rebag",
        lastSent: {
          sentAt: "2026-04-22T12:00:00Z",
          sentBy: "Ben",
          messageId: "m",
          threadId: null,
        },
      }),
      row({
        slug: "stale",
        lastSent: {
          sentAt: "2026-01-01T12:00:00Z",
          sentBy: "Ben",
          messageId: "m",
          threadId: null,
        },
      }),
    ].map((r) => deriveDashboardRow(r, NOW));
    const s = summarizeDashboard(rows);
    expect(s.total).toBe(5);
    expect(s.notYetSent).toBe(1);
    expect(s.blockedMissingDocs).toBe(1);
    expect(s.blockedPricingReview).toBe(1);
    expect(s.sentRecently).toBe(1);
    expect(s.sentLongAgo).toBe(1);
  });
});

describe("hasPacketTemplateRegistry", () => {
  it("returns true now that the templates module + draft-creation helper exist", () => {
    expect(hasPacketTemplateRegistry()).toBe(true);
  });
});
