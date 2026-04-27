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
  composeSalesCommandSlice,
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

// ---------------------------------------------------------------------------
// Phase 2 — composeSalesCommandSlice (compact projection for the morning brief)
// ---------------------------------------------------------------------------

describe("composeSalesCommandSlice — compact projection", () => {
  it("all not_wired → every numeric is null and anyAction=false", () => {
    const slice = composeSalesCommandSlice(emptyInput());
    expect(slice.faireInvitesNeedsReview).toBeNull();
    expect(slice.faireFollowUpsOverdue).toBeNull();
    expect(slice.faireFollowUpsDueSoon).toBeNull();
    expect(slice.pendingApprovals).toBeNull();
    expect(slice.apPacketsActionRequired).toBeNull();
    expect(slice.apPacketsSent).toBeNull();
    expect(slice.retailDraftsNeedsReview).toBeNull();
    expect(slice.retailDraftsAccepted).toBeNull();
    expect(slice.wholesaleInquiries).toBeNull();
    expect(slice.anyAction).toBe(false);
  });

  it("empty-but-wired sources surface as 0 (not null) and do NOT trip anyAction", () => {
    const slice = composeSalesCommandSlice({
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
      apPackets: sourceWired({
        total: 0,
        ready_to_send: 0,
        action_required: 0,
        sent: 0,
      }),
      locationDrafts: sourceWired({
        needs_review: 0,
        accepted: 0,
        rejected: 0,
        total: 0,
      }),
      pendingApprovals: sourceWired({
        total: 0,
        byTargetType: {},
        preview: [],
      }),
    });
    expect(slice.faireInvitesNeedsReview).toBe(0);
    expect(slice.faireFollowUpsOverdue).toBe(0);
    expect(slice.faireFollowUpsDueSoon).toBe(0);
    expect(slice.pendingApprovals).toBe(0);
    expect(slice.apPacketsActionRequired).toBe(0);
    expect(slice.apPacketsSent).toBe(0);
    expect(slice.retailDraftsNeedsReview).toBe(0);
    expect(slice.retailDraftsAccepted).toBe(0);
    expect(slice.anyAction).toBe(false);
  });

  it("anyAction=true when at least one ACTIONABLE wired count is positive", () => {
    const slice = composeSalesCommandSlice({
      ...emptyInput(),
      faireFollowUps: sourceWired({
        counts: { overdue: 2, due_soon: 0, not_due: 0, sent_total: 5 },
        actionable: [],
      }),
    });
    expect(slice.faireFollowUpsOverdue).toBe(2);
    expect(slice.anyAction).toBe(true);
  });

  it("a wholesale-inquiries-only positive count does NOT trip anyAction (read-only signal)", () => {
    // Wholesale inquiries today is `not_wired`, but even when wired
    // it shouldn't drive 'morning action' on its own — it's
    // contextual data. anyAction only fires on rows the operator can
    // act on. Locked here so future not_wired→wired flips don't
    // accidentally noisify the morning brief.
    const slice = composeSalesCommandSlice({
      ...emptyInput(),
      wholesaleInquiries: sourceWired({ total: 17 }),
    });
    expect(slice.wholesaleInquiries).toBe(17);
    expect(slice.anyAction).toBe(false);
  });

  it("exact propagation — counts mirror the source (no inflation)", () => {
    const slice = composeSalesCommandSlice({
      ...emptyInput(),
      faireInvites: sourceWired({
        needs_review: 3,
        approved: 1,
        sent: 7,
        rejected: 2,
        total: 13,
      }),
      apPackets: sourceWired({
        total: 4,
        ready_to_send: 1,
        action_required: 2,
        sent: 1,
      }),
      pendingApprovals: sourceWired({
        total: 5,
        byTargetType: {},
        preview: [],
      }),
    });
    expect(slice.faireInvitesNeedsReview).toBe(3);
    expect(slice.apPacketsActionRequired).toBe(2);
    expect(slice.apPacketsSent).toBe(1);
    expect(slice.pendingApprovals).toBe(5);
  });

  it("error-state source projects as null (matches not_wired) — no fabricated zero", () => {
    const slice = composeSalesCommandSlice({
      ...emptyInput(),
      faireInvites: sourceError("KV outage"),
    });
    expect(slice.faireInvitesNeedsReview).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — aging section assembly + slice agingCallouts
// ---------------------------------------------------------------------------

describe("buildSalesCommandCenter — aging section", () => {
  function agingItem(
    source:
      | "approval"
      | "faire-followup"
      | "ap-packet"
      | "location-draft"
      | "receipt",
    ageHours: number,
    tier: "fresh" | "watch" | "overdue" | "critical",
    id = `${source}-${ageHours}`,
  ) {
    return {
      source,
      id,
      label: `${source} ${id}`,
      link: "/ops/sales",
      anchorAt: new Date(NOW.getTime() - ageHours * 3600_000).toISOString(),
      ageHours,
      ageDays: ageHours / 24,
      tier,
    };
  }

  it("counts every tier including fresh", () => {
    const report = buildSalesCommandCenter(
      {
        ...emptyInput(),
        agingItems: [
          agingItem("approval", 100, "critical"),
          agingItem("approval", 30, "overdue"),
          agingItem("approval", 5, "watch"),
          agingItem("approval", 1, "fresh"),
          agingItem("approval", 0.5, "fresh", "f-2"),
        ],
      },
      { now: NOW },
    );
    expect(report.aging.counts).toEqual({
      critical: 1,
      overdue: 1,
      watch: 1,
      fresh: 2,
      total: 5,
    });
  });

  it("topItems excludes fresh + caps at default limit (10)", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      agingItem("approval", 100 + i, "critical", `c-${i}`),
    );
    const report = buildSalesCommandCenter(
      { ...emptyInput(), agingItems: items },
      { now: NOW },
    );
    expect(report.aging.topItems).toHaveLength(10);
  });

  it("agingTopLimit override is honored", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      agingItem("approval", 100 + i, "critical", `c-${i}`),
    );
    const report = buildSalesCommandCenter(
      { ...emptyInput(), agingItems: items, agingTopLimit: 3 },
      { now: NOW },
    );
    expect(report.aging.topItems).toHaveLength(3);
  });

  it("missingTimestamps panel mirrors caller-supplied list", () => {
    const report = buildSalesCommandCenter(
      {
        ...emptyInput(),
        agingMissing: [
          {
            source: "ap-packet",
            id: "jj",
            label: "JJ Foods",
            link: "/ops/ap-packets",
            reason: "AP packet config has no readyAt timestamp.",
          },
        ],
      },
      { now: NOW },
    );
    expect(report.aging.missingTimestamps).toHaveLength(1);
    expect(report.aging.missingTimestamps[0].source).toBe("ap-packet");
    expect(report.aging.missingTimestamps[0].reason).toContain("readyAt");
  });

  it("empty inputs produce a clean empty aging section (no fabricated rows)", () => {
    const report = buildSalesCommandCenter(emptyInput(), { now: NOW });
    expect(report.aging.counts).toEqual({
      critical: 0,
      overdue: 0,
      watch: 0,
      fresh: 0,
      total: 0,
    });
    expect(report.aging.topItems).toEqual([]);
    expect(report.aging.missingTimestamps).toEqual([]);
  });

  it("topItems is sorted critical→overdue→watch (oldest-first within tier)", () => {
    const report = buildSalesCommandCenter(
      {
        ...emptyInput(),
        agingItems: [
          agingItem("approval", 5, "watch", "w1"),
          agingItem("approval", 30, "overdue", "o1"),
          agingItem("approval", 100, "critical", "c1"),
          agingItem("approval", 200, "critical", "c2-older"),
        ],
      },
      { now: NOW },
    );
    expect(report.aging.topItems.map((r) => r.id)).toEqual([
      "c2-older",
      "c1",
      "o1",
      "w1",
    ]);
  });

  it("composeSalesCommandSlice surfaces up to 3 aging callouts (critical-first)", () => {
    const slice = composeSalesCommandSlice({
      ...emptyInput(),
      agingItems: [
        agingItem("approval", 100, "critical", "c1"),
        agingItem("approval", 200, "critical", "c2"),
        agingItem("approval", 300, "critical", "c3"),
        agingItem("approval", 400, "critical", "c4-dropped"),
      ],
    });
    expect(slice.agingCallouts).toBeDefined();
    expect(slice.agingCallouts!.length).toBe(3);
    expect(slice.agingCallouts!.every((c) => c.tier === "critical")).toBe(true);
  });

  it("anyAction trips on aging-only signal (no per-source counts > 0)", () => {
    const slice = composeSalesCommandSlice({
      ...emptyInput(),
      agingItems: [agingItem("approval", 100, "critical")],
    });
    expect(slice.anyAction).toBe(true);
  });

  it("anyAction stays false when only fresh items exist (no aging trip)", () => {
    const slice = composeSalesCommandSlice({
      ...emptyInput(),
      agingItems: [agingItem("approval", 1, "fresh")],
    });
    expect(slice.anyAction).toBe(false);
    expect(slice.agingCallouts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — KPI scorecard section + slice revenueKpi line
// ---------------------------------------------------------------------------

describe("buildSalesCommandCenter — KPI scorecard section", () => {
  it("attaches a kpiScorecard to the report", () => {
    const report = buildSalesCommandCenter(emptyInput(), { now: NOW });
    expect(report.kpiScorecard).toBeDefined();
    expect(report.kpiScorecard.target.usd).toBe(1_000_000);
    expect(report.kpiScorecard.target.deadlineIso).toBe(
      "2026-12-24T23:59:59-08:00",
    );
  });

  it("with no revenueChannels supplied, actualLast7dUsd is null and confidence is 'none'", () => {
    const report = buildSalesCommandCenter(emptyInput(), { now: NOW });
    expect(report.kpiScorecard.actualLast7dUsd).toBeNull();
    expect(report.kpiScorecard.gapToWeeklyPaceUsd).toBeNull();
    expect(report.kpiScorecard.confidence).toBe("none");
  });

  it("daysRemaining uses the options.now (not real wall-clock) — deterministic", () => {
    const report = buildSalesCommandCenter(emptyInput(), { now: NOW });
    expect(report.kpiScorecard.daysRemaining).toBeGreaterThan(200);
  });

  it("propagates wired channels into the report (actual sums correctly)", () => {
    const report = buildSalesCommandCenter(
      {
        ...emptyInput(),
        revenueChannels: [
          {
            channel: "shopify",
            status: "wired",
            amountUsd: 1500,
            source: { system: "shopify-test", retrievedAt: NOW.toISOString() },
          },
          {
            channel: "amazon",
            status: "wired",
            amountUsd: 250.5,
            source: { system: "amazon-test", retrievedAt: NOW.toISOString() },
          },
        ],
      },
      { now: NOW },
    );
    expect(report.kpiScorecard.actualLast7dUsd).toBe(1750.5);
  });
});

describe("composeSalesCommandSlice — revenueKpi one-liner", () => {
  it("falls back to 'not fully wired' when no channel is wired", () => {
    const slice = composeSalesCommandSlice(emptyInput());
    expect(slice.revenueKpi).toBeDefined();
    expect(slice.revenueKpi!.text).toBe("Revenue pace not fully wired.");
    expect(slice.revenueKpi!.fullyWired).toBe(false);
  });

  it("renders a compact line when at least one channel is wired", () => {
    const slice = composeSalesCommandSlice({
      ...emptyInput(),
      revenueChannels: [
        {
          channel: "shopify",
          status: "wired",
          amountUsd: 12_000,
        },
      ],
    });
    expect(slice.revenueKpi!.text).toMatch(/Revenue pace:/);
    expect(slice.revenueKpi!.text).toMatch(/last 7d/);
    expect(slice.revenueKpi!.text).toMatch(/required\/wk/);
  });

  it("revenueKpi line never includes a $ when no actual is computed (no fabrication)", () => {
    const slice = composeSalesCommandSlice({
      ...emptyInput(),
      revenueChannels: [
        {
          channel: "shopify",
          status: "not_wired",
          amountUsd: null,
          reason: "no token",
        },
      ],
    });
    expect(slice.revenueKpi!.text).not.toMatch(/\$/);
  });
});

/**
 * Phase 28f — dispatchSummary section.
 *
 * Locks the contract:
 *   - When `dispatchRows` is omitted: both counts are not_wired with
 *     a reason. Default reason "ShipStation not configured." can be
 *     overridden via `dispatchNotWiredReason`.
 *   - When provided: openCount counts state==="open"; dispatchedLast24h
 *     counts rows whose dispatchedAt is in [now-24h, now); both
 *     counters are independent (a row dispatched at 11pm yesterday
 *     counts toward dispatched but is no longer "open").
 *   - oldestOpenShipDate is the lex-smallest ISO date among open rows;
 *     null when none. Lex order matches chronological for fixed-width
 *     YYYY-MM-DD, no Date parsing required.
 *   - Garbage shipDate / dispatchedAt values don't crash and don't count.
 *   - deepLink always present and points to /ops/shipping/dispatch.
 */
describe("buildSalesCommandCenter — dispatchSummary section", () => {
  const NOW_DISPATCH = new Date("2026-04-26T18:00:00Z");
  const inWindow = (hoursAgo: number) =>
    new Date(NOW_DISPATCH.getTime() - hoursAgo * 3600 * 1000).toISOString();

  it("not_wired with default reason when dispatchRows omitted", () => {
    const r = buildSalesCommandCenter(emptyInput(), { now: NOW_DISPATCH });
    expect(r.dispatchSummary.openCount.status).toBe("not_wired");
    expect(r.dispatchSummary.dispatchedLast24h.status).toBe("not_wired");
    if (r.dispatchSummary.openCount.status === "not_wired") {
      expect(r.dispatchSummary.openCount.reason).toMatch(
        /ShipStation not configured/,
      );
    }
    expect(r.dispatchSummary.deepLink).toBe("/ops/shipping/dispatch");
  });

  it("not_wired uses caller-supplied reason when dispatchNotWiredReason is set", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        dispatchNotWiredReason: "ShipStation read failed: timeout",
      },
      { now: NOW_DISPATCH },
    );
    if (r.dispatchSummary.openCount.status === "not_wired") {
      expect(r.dispatchSummary.openCount.reason).toBe(
        "ShipStation read failed: timeout",
      );
    } else {
      throw new Error("expected not_wired");
    }
  });

  it("counts open rows + dispatched-last-24h independently", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        dispatchRows: [
          // open, shipped today
          { state: "open", shipDate: "2026-04-26", dispatchedAt: null },
          // open, shipped 3 days ago — oldest open
          { state: "open", shipDate: "2026-04-23", dispatchedAt: null },
          // dispatched 2h ago — counts toward dispatchedLast24h, NOT open
          {
            state: "dispatched",
            shipDate: "2026-04-25",
            dispatchedAt: inWindow(2),
          },
          // dispatched 30h ago — out of 24h window, doesn't count
          {
            state: "dispatched",
            shipDate: "2026-04-24",
            dispatchedAt: inWindow(30),
          },
        ],
      },
      { now: NOW_DISPATCH },
    );
    if (
      r.dispatchSummary.openCount.status !== "wired" ||
      r.dispatchSummary.dispatchedLast24h.status !== "wired"
    ) {
      throw new Error("expected wired");
    }
    expect(r.dispatchSummary.openCount.value).toBe(2);
    expect(r.dispatchSummary.dispatchedLast24h.value).toBe(1);
    expect(r.dispatchSummary.oldestOpenShipDate).toBe("2026-04-23");
  });

  it("oldestOpenShipDate is null when no open rows", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        dispatchRows: [
          {
            state: "dispatched",
            shipDate: "2026-04-25",
            dispatchedAt: inWindow(2),
          },
        ],
      },
      { now: NOW_DISPATCH },
    );
    expect(r.dispatchSummary.oldestOpenShipDate).toBeNull();
  });

  it("garbage shipDate / dispatchedAt don't crash and don't count", () => {
    const r = buildSalesCommandCenter(
      {
        ...emptyInput(),
        dispatchRows: [
          { state: "open", shipDate: "garbage", dispatchedAt: null },
          { state: "open", shipDate: null, dispatchedAt: null },
          {
            state: "dispatched",
            shipDate: "2026-04-25",
            dispatchedAt: "also garbage",
          },
        ],
      },
      { now: NOW_DISPATCH },
    );
    if (
      r.dispatchSummary.openCount.status !== "wired" ||
      r.dispatchSummary.dispatchedLast24h.status !== "wired"
    ) {
      throw new Error("expected wired");
    }
    expect(r.dispatchSummary.openCount.value).toBe(2);
    expect(r.dispatchSummary.dispatchedLast24h.value).toBe(0);
    expect(r.dispatchSummary.oldestOpenShipDate).toBeNull();
  });

  it("empty rows array is valid (zero counts, both wired)", () => {
    const r = buildSalesCommandCenter(
      { ...emptyInput(), dispatchRows: [] },
      { now: NOW_DISPATCH },
    );
    if (
      r.dispatchSummary.openCount.status !== "wired" ||
      r.dispatchSummary.dispatchedLast24h.status !== "wired"
    ) {
      throw new Error("expected wired");
    }
    expect(r.dispatchSummary.openCount.value).toBe(0);
    expect(r.dispatchSummary.dispatchedLast24h.value).toBe(0);
  });
});
