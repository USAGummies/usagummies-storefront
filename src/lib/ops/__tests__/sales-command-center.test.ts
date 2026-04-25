/**
 * Tests for the Sales Command Center aggregator.
 *
 * Locked contracts:
 *   - A `not_wired` source surfaces as `null` in the top-of-page
 *     stats (NOT zero — that would be a fabricated count).
 *   - A `not_wired` or `error` source contributes a row to the
 *     blockers panel with its reason verbatim.
 *   - The follow-up "topActionable" preserves caller-supplied sort
 *     order (most-stale-first per `reportFollowUps`) and slices to
 *     at most 5 rows.
 *   - An empty-but-wired source renders as 0/0/0/0 (not error, not
 *     not_wired). The dashboard distinguishes "wired but quiet"
 *     from "no API at all".
 *   - The `anyAction` flag is true iff at least one *wired* count is
 *     positive. A null (not_wired) value never trips it.
 *   - The aggregator is pure — no fetch, no KV, no module-level state.
 */
import { describe, expect, it } from "vitest";

import {
  buildSalesCommandCenter,
  sourceError,
  sourceNotWired,
  sourceWired,
  type FaireFollowUpRowSummary,
  type SalesCommandCenterInput,
} from "../sales-command-center";

const NOW = new Date("2026-04-30T12:00:00Z");

function followUpRow(
  overrides: Partial<FaireFollowUpRowSummary> = {},
): FaireFollowUpRowSummary {
  return {
    id: "buyer@x.com",
    retailerName: "Test",
    email: "buyer@x.com",
    daysSinceSent: 5,
    bucket: "due_soon",
    ...overrides,
  };
}

function emptyInput(): SalesCommandCenterInput {
  return {
    faireInvites: sourceNotWired("test"),
    faireFollowUps: sourceNotWired("test"),
    pendingApprovals: sourceNotWired("test"),
    apPackets: sourceNotWired("test"),
    locationDrafts: sourceNotWired("test"),
    wholesaleInquiries: sourceNotWired("test"),
  };
}

describe("buildSalesCommandCenter — top-of-page roll-ups", () => {
  it("a not_wired source surfaces as null (not zero)", () => {
    const r = buildSalesCommandCenter(emptyInput(), { now: NOW });
    expect(r.todaysRevenueActions.faireInvitesNeedsReview).toBeNull();
    expect(r.todaysRevenueActions.faireFollowUpsActionable).toBeNull();
    expect(r.todaysRevenueActions.pendingApprovals).toBeNull();
    expect(r.todaysRevenueActions.retailDraftsNeedsReview).toBeNull();
    expect(r.todaysRevenueActions.apPacketsActionRequired).toBeNull();
  });

  it("an empty-but-wired source surfaces as 0 (NOT null — distinguishes 'no rows' from 'no API')", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        faireInvites: sourceWired({
          needs_review: 0,
          approved: 0,
          sent: 0,
          rejected: 0,
          total: 0,
        }),
        locationDrafts: sourceWired({
          needs_review: 0,
          accepted: 0,
          rejected: 0,
          total: 0,
        }),
      },
      { now: NOW },
    );
    expect(r.todaysRevenueActions.faireInvitesNeedsReview).toBe(0);
    expect(r.todaysRevenueActions.retailDraftsNeedsReview).toBe(0);
  });

  it("a wired source's count is reflected exactly (no inflation)", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        faireInvites: sourceWired({
          needs_review: 3,
          approved: 1,
          sent: 7,
          rejected: 2,
          total: 13,
        }),
        apPackets: sourceWired({
          total: 2,
          ready_to_send: 1,
          action_required: 1,
          sent: 0,
        }),
        pendingApprovals: sourceWired({
          total: 4,
          byTargetType: {},
          preview: [],
        }),
      },
      { now: NOW },
    );
    expect(r.todaysRevenueActions.faireInvitesNeedsReview).toBe(3);
    expect(r.todaysRevenueActions.apPacketsActionRequired).toBe(1);
    expect(r.todaysRevenueActions.pendingApprovals).toBe(4);
  });

  it("anyAction=false when every source is not_wired or has zero actionable rows", () => {
    const r = buildSalesCommandCenter(emptyInput(), { now: NOW });
    expect(r.todaysRevenueActions.anyAction).toBe(false);

    const r2 = buildSalesCommandCenter(
      {
        ...emptyInput(),
        faireInvites: sourceWired({
          needs_review: 0,
          approved: 0,
          sent: 0,
          rejected: 0,
          total: 0,
        }),
        faireFollowUps: sourceWired({
          counts: { overdue: 0, due_soon: 0, not_due: 0, sent_total: 0 },
          actionable: [],
        }),
      },
      { now: NOW },
    );
    expect(r2.todaysRevenueActions.anyAction).toBe(false);
  });

  it("anyAction=true when at least one wired count is positive", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        faireFollowUps: sourceWired({
          counts: { overdue: 1, due_soon: 0, not_due: 5, sent_total: 6 },
          actionable: [followUpRow({ bucket: "overdue", daysSinceSent: 9 })],
        }),
      },
      { now: NOW },
    );
    expect(r.todaysRevenueActions.faireFollowUpsActionable).toBe(1);
    expect(r.todaysRevenueActions.anyAction).toBe(true);
  });
});

describe("buildSalesCommandCenter — follow-ups section", () => {
  it("preserves caller-supplied sort order (most-stale-first)", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        faireFollowUps: sourceWired({
          counts: { overdue: 2, due_soon: 1, not_due: 0, sent_total: 3 },
          actionable: [
            followUpRow({ id: "old-30", daysSinceSent: 30, bucket: "overdue" }),
            followUpRow({ id: "old-10", daysSinceSent: 10, bucket: "overdue" }),
            followUpRow({ id: "old-5", daysSinceSent: 5, bucket: "due_soon" }),
          ],
        }),
      },
      { now: NOW },
    );
    expect(r.followUps.state.status).toBe("wired");
    if (r.followUps.state.status === "wired") {
      expect(r.followUps.state.value.topActionable.map((x) => x.id)).toEqual([
        "old-30",
        "old-10",
        "old-5",
      ]);
    }
  });

  it("slices to at most 5 actionable rows (preview only — full list is on /ops/faire-direct)", () => {
    const rows: FaireFollowUpRowSummary[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push(followUpRow({ id: `r-${i}`, daysSinceSent: 30 - i }));
    }
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        faireFollowUps: sourceWired({
          counts: { overdue: 12, due_soon: 0, not_due: 0, sent_total: 12 },
          actionable: rows,
        }),
      },
      { now: NOW },
    );
    if (r.followUps.state.status === "wired") {
      expect(r.followUps.state.value.topActionable).toHaveLength(5);
      // First five preserved.
      expect(r.followUps.state.value.topActionable[0].id).toBe("r-0");
      expect(r.followUps.state.value.topActionable[4].id).toBe("r-4");
    }
  });

  it("empty queue is still 'wired' with zero counts (does NOT downgrade to not_wired)", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        faireFollowUps: sourceWired({
          counts: { overdue: 0, due_soon: 0, not_due: 0, sent_total: 0 },
          actionable: [],
        }),
      },
      { now: NOW },
    );
    expect(r.followUps.state.status).toBe("wired");
    if (r.followUps.state.status === "wired") {
      expect(r.followUps.state.value.topActionable).toEqual([]);
    }
  });
});

describe("buildSalesCommandCenter — section state propagation", () => {
  it("Faire Direct section carries the source state verbatim", () => {
    const counts = {
      needs_review: 3,
      approved: 1,
      sent: 4,
      rejected: 0,
      total: 8,
    };
    const r = buildSalesCommandCenter(
      { ...emptyInput(), faireInvites: sourceWired(counts) },
      { now: NOW },
    );
    expect(r.faireDirect.state).toEqual({ status: "wired", value: counts });
    expect(r.faireDirect.link.href).toBe("/ops/faire-direct");
  });

  it("Wholesale onboarding surfaces inquiries as not_wired with the caller's reason", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        wholesaleInquiries: sourceNotWired(
          "No internal list endpoint for wholesale inquiries.",
        ),
      },
      { now: NOW },
    );
    expect(r.wholesaleOnboarding.inquiries.status).toBe("not_wired");
    if (r.wholesaleOnboarding.inquiries.status === "not_wired") {
      expect(r.wholesaleOnboarding.inquiries.reason).toContain(
        "No internal list endpoint",
      );
    }
  });

  it("retail proof + Faire Direct + follow-up sections all carry deep-links to existing surfaces", () => {
    const r = buildSalesCommandCenter(emptyInput(), { now: NOW });
    expect(r.retailProof.link.href).toBe("/ops/locations");
    expect(r.faireDirect.link.href).toBe("/ops/faire-direct");
    // The follow-up queue lives on the same `/ops/faire-direct` page
    // as the invite queue (Phase 3.2 added <FollowUpSection> there).
    // Don't fabricate a separate URL.
    expect(r.followUps.link.href).toBe("/ops/faire-direct");
  });
});

describe("buildSalesCommandCenter — blockers panel", () => {
  it("collects every not_wired and error source with verbatim reasons", () => {
    const r = buildSalesCommandCenter(
      {
        faireInvites: sourceWired({
          needs_review: 0,
          approved: 0,
          sent: 0,
          rejected: 0,
          total: 0,
        }),
        faireFollowUps: sourceError("Faire follow-up read failed: KV outage"),
        wholesaleInquiries: sourceNotWired("No list endpoint."),
        pendingApprovals: sourceWired({
          total: 0,
          byTargetType: {},
          preview: [],
        }),
        apPackets: sourceNotWired("Future Phase 2 build"),
        locationDrafts: sourceWired({
          needs_review: 0,
          accepted: 0,
          rejected: 0,
          total: 0,
        }),
        missingEnv: ["FAIRE_ACCESS_TOKEN"],
      },
      { now: NOW },
    );
    const sources = r.blockers.notes.map((n) => n.source).sort();
    expect(sources).toEqual([
      "apPackets",
      "faireFollowUps",
      "wholesaleInquiries",
    ]);
    const followUpNote = r.blockers.notes.find(
      (n) => n.source === "faireFollowUps",
    );
    expect(followUpNote?.state).toBe("error");
    expect(followUpNote?.reason).toMatch(/KV outage/);
    const wholesaleNote = r.blockers.notes.find(
      (n) => n.source === "wholesaleInquiries",
    );
    expect(wholesaleNote?.state).toBe("not_wired");
    expect(r.blockers.missingEnv).toEqual(["FAIRE_ACCESS_TOKEN"]);
    expect(r.blockers.link.href).toBe("/ops/readiness");
  });

  it("empty notes when every source is wired", () => {
    const r = buildSalesCommandCenter(
      {
        faireInvites: sourceWired({
          needs_review: 0,
          approved: 0,
          sent: 0,
          rejected: 0,
          total: 0,
        }),
        faireFollowUps: sourceWired({
          counts: { overdue: 0, due_soon: 0, not_due: 0, sent_total: 0 },
          actionable: [],
        }),
        wholesaleInquiries: sourceWired({ total: 0 }),
        pendingApprovals: sourceWired({
          total: 0,
          byTargetType: {},
          preview: [],
        }),
        apPackets: sourceWired({
          total: 1,
          ready_to_send: 1,
          action_required: 0,
          sent: 0,
        }),
        locationDrafts: sourceWired({
          needs_review: 0,
          accepted: 0,
          rejected: 0,
          total: 0,
        }),
      },
      { now: NOW },
    );
    expect(r.blockers.notes).toEqual([]);
  });

  it("missingEnv defaults to empty array when caller omits it", () => {
    const r = buildSalesCommandCenter(emptyInput(), { now: NOW });
    expect(r.blockers.missingEnv).toEqual([]);
  });
});

describe("Phase 1 invariant — pure aggregator", () => {
  it("the module exports are pure functions (no fetch / KV / module-level singletons)", () => {
    // Two calls with the same input produce equal output (with the
    // same `now` to control timestamps).
    const input = emptyInput();
    const a = buildSalesCommandCenter(input, { now: NOW });
    const b = buildSalesCommandCenter(input, { now: NOW });
    expect(a).toEqual(b);
  });

  it("calling the aggregator does not throw on an all-not_wired input", () => {
    expect(() =>
      buildSalesCommandCenter(emptyInput(), { now: NOW }),
    ).not.toThrow();
  });
});
