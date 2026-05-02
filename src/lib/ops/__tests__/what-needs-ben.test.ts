/**
 * What-needs-ben aggregator coverage.
 *
 * Pins:
 *   - Lane projections produce posture from each domain summary.
 *   - Email whale-count → red posture (regardless of total).
 *   - Proposals: flagged direct-mutation in queued → red.
 *   - Overall posture = worst lane (red > yellow > unknown > green).
 *   - Recommendation picks worst lane, tie-broken by LANE_PRIORITY
 *     (shipping → finance → email → sales → proposals → marketing).
 *   - Null inputs surface as `unknown` lane (degraded=true, summary="unavailable").
 *   - Clean-across-all → "Clean across all lanes" copy + null laneId.
 *   - Degraded list passthrough.
 */
import { describe, expect, it } from "vitest";

import {
  summarizeWhatNeedsBen,
  type WhatNeedsBenInput,
} from "../what-needs-ben";

const NOW = new Date("2026-05-02T18:00:00Z");

const EMAIL_GREEN = {
  total: 0,
  byStatus: { received: 0, received_noise: 0, classified: 0, classified_whale: 0 },
  byCategory: {},
  whaleCount: 0,
  oldestReceived: null,
  topRows: [],
  backlogReceived: 0,
};

const FINANCE_GREEN = {
  pendingPromote: 0,
  pendingFinanceApprovals: 0,
  draftPackets: 0,
  reneApprovedPackets: 0,
  rejectedPackets: 0,
  draftEligiblePackets: 0,
  oldestPendingApprovals: [],
  topPackets: [],
  posture: "green" as const,
  degraded: [],
};

const MARKETING_GREEN = {
  generatedAt: NOW.toISOString(),
  platforms: [],
  totals: {
    spend30d: 0,
    revenue30d: 0,
    conversions30d: 0,
    roas30d: 0,
    activeCampaigns: 0,
    configuredPlatforms: 0,
  },
  pendingApprovals: 0,
  oldestPendingApprovals: [],
  blockers: [],
  posture: "green" as const,
  degraded: [],
};

const SHIPPING_GREEN = {
  generatedAt: NOW.toISOString(),
  retryQueue: { total: 0, pending: 0, exhausted: 0, oldestPending: [] },
  pendingApprovals: 0,
  oldestPendingApprovals: [],
  wallet: [],
  walletAlerts: [],
  posture: "green" as const,
  degraded: [],
};

const PROPOSALS_GREEN = {
  total: 0,
  queued: 0,
  reviewed: 0,
  promoted: 0,
  rejected: 0,
  byDepartment: {},
  bySource: {},
  flaggedDirectMutation: 0,
  topQueued: [],
};

const SALES_GREEN = { pendingApprovals: 0, staleApprovals: 0 };

const ALL_GREEN: WhatNeedsBenInput = {
  email: EMAIL_GREEN,
  finance: FINANCE_GREEN,
  marketing: MARKETING_GREEN,
  shipping: SHIPPING_GREEN,
  proposals: PROPOSALS_GREEN,
  sales: SALES_GREEN,
  now: NOW,
};

describe("summarizeWhatNeedsBen — overall posture", () => {
  it("green when every lane is green", () => {
    const r = summarizeWhatNeedsBen(ALL_GREEN);
    expect(r.posture).toBe("green");
    expect(r.recommendation.laneId).toBeNull();
    expect(r.recommendation.text).toMatch(/Clean across all lanes/);
  });

  it("yellow when only yellow lanes (no red)", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      finance: { ...FINANCE_GREEN, posture: "yellow", pendingFinanceApprovals: 1 },
    });
    expect(r.posture).toBe("yellow");
  });

  it("red when any lane is red — overall escalates", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      shipping: {
        ...SHIPPING_GREEN,
        posture: "red",
        retryQueue: { total: 1, pending: 0, exhausted: 1, oldestPending: [] },
      },
    });
    expect(r.posture).toBe("red");
    expect(r.recommendation.laneId).toBe("shipping");
    expect(r.recommendation.text).toMatch(/🚨 Start with \*Shipping\*/);
  });

  it("unknown lane forces overall=unknown when no red/yellow lanes (be conservative — don't claim green if a fetch is missing)", () => {
    const r = summarizeWhatNeedsBen({ ...ALL_GREEN, finance: null });
    // 5 green + 1 unknown → overall unknown (we don't claim green on
    // missing data; operator should investigate the degraded source).
    expect(r.posture).toBe("unknown");
    const fin = r.lanes.find((l) => l.id === "finance");
    expect(fin?.posture).toBe("unknown");
    expect(fin?.degraded).toBe(true);
  });

  it("yellow takes priority over unknown for overall posture", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      shipping: { ...SHIPPING_GREEN, posture: "yellow", retryQueue: { total: 1, pending: 1, exhausted: 0, oldestPending: [] } },
      finance: null,
    });
    expect(r.posture).toBe("yellow");
  });
});

describe("summarizeWhatNeedsBen — email lane projection", () => {
  it("whale-class queued → red posture", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      email: {
        ...EMAIL_GREEN,
        total: 1,
        whaleCount: 1,
        byStatus: { ...EMAIL_GREEN.byStatus, classified_whale: 1 },
      },
    });
    const email = r.lanes.find((l) => l.id === "email")!;
    expect(email.posture).toBe("red");
    expect(email.summary).toMatch(/whale/);
  });

  it("classified > 0 → yellow posture", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      email: {
        ...EMAIL_GREEN,
        total: 1,
        byStatus: { ...EMAIL_GREEN.byStatus, classified: 1 },
      },
    });
    const email = r.lanes.find((l) => l.id === "email")!;
    expect(email.posture).toBe("yellow");
  });

  it("backlog > 0 → yellow posture (waiting on classifier)", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      email: {
        ...EMAIL_GREEN,
        total: 1,
        backlogReceived: 1,
        byStatus: { ...EMAIL_GREEN.byStatus, received: 1 },
      },
    });
    expect(r.lanes.find((l) => l.id === "email")?.posture).toBe("yellow");
  });

  it("only noise → green", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      email: {
        ...EMAIL_GREEN,
        total: 5,
        byStatus: { ...EMAIL_GREEN.byStatus, received_noise: 5 },
      },
    });
    expect(r.lanes.find((l) => l.id === "email")?.posture).toBe("green");
  });
});

describe("summarizeWhatNeedsBen — proposals lane projection", () => {
  it("flagged direct-mutation in queued → red", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      proposals: {
        ...PROPOSALS_GREEN,
        total: 1,
        queued: 1,
        flaggedDirectMutation: 1,
      },
    });
    expect(r.lanes.find((l) => l.id === "proposals")?.posture).toBe("red");
  });

  it("queued > 0 without flags → yellow", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      proposals: { ...PROPOSALS_GREEN, total: 1, queued: 1 },
    });
    expect(r.lanes.find((l) => l.id === "proposals")?.posture).toBe("yellow");
  });

  it("0 queued → green", () => {
    const r = summarizeWhatNeedsBen(ALL_GREEN);
    expect(r.lanes.find((l) => l.id === "proposals")?.posture).toBe("green");
  });
});

describe("summarizeWhatNeedsBen — sales lane projection", () => {
  it("stale approvals → red", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      sales: { pendingApprovals: 1, staleApprovals: 1 },
    });
    expect(r.lanes.find((l) => l.id === "sales")?.posture).toBe("red");
  });

  it("pending only → yellow", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      sales: { pendingApprovals: 1, staleApprovals: 0 },
    });
    expect(r.lanes.find((l) => l.id === "sales")?.posture).toBe("yellow");
  });

  it("clean → green", () => {
    const r = summarizeWhatNeedsBen(ALL_GREEN);
    expect(r.lanes.find((l) => l.id === "sales")?.posture).toBe("green");
  });

  it("posture override forces specific value", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      sales: { pendingApprovals: 0, staleApprovals: 0, posture: "red" },
    });
    expect(r.lanes.find((l) => l.id === "sales")?.posture).toBe("red");
  });
});

describe("summarizeWhatNeedsBen — recommendation tie-breaking", () => {
  it("shipping wins over finance when both are red (priority order)", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      shipping: {
        ...SHIPPING_GREEN,
        posture: "red",
        retryQueue: { total: 1, pending: 0, exhausted: 1, oldestPending: [] },
      },
      finance: {
        ...FINANCE_GREEN,
        posture: "red",
        pendingFinanceApprovals: 1,
      },
    });
    expect(r.recommendation.laneId).toBe("shipping");
  });

  it("finance wins over email when both are yellow (priority)", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      finance: { ...FINANCE_GREEN, posture: "yellow", pendingFinanceApprovals: 1 },
      email: {
        ...EMAIL_GREEN,
        total: 1,
        byStatus: { ...EMAIL_GREEN.byStatus, classified: 1 },
      },
    });
    expect(r.recommendation.laneId).toBe("finance");
  });

  it("recommendation includes the slashCommand", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      shipping: {
        ...SHIPPING_GREEN,
        posture: "red",
        retryQueue: { total: 1, pending: 0, exhausted: 1, oldestPending: [] },
      },
    });
    expect(r.recommendation.text).toMatch(/`shipping today`/);
  });
});

describe("summarizeWhatNeedsBen — counts + degraded", () => {
  it("counts by posture", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      shipping: {
        ...SHIPPING_GREEN,
        posture: "red",
        retryQueue: { total: 1, pending: 0, exhausted: 1, oldestPending: [] },
      },
      finance: { ...FINANCE_GREEN, posture: "yellow", pendingFinanceApprovals: 1 },
      email: null, // unknown
    });
    expect(r.counts.red).toBe(1);
    expect(r.counts.yellow).toBe(1);
    expect(r.counts.unknown).toBe(1);
    expect(r.counts.green).toBe(3);
  });

  it("forwards source-level degraded list", () => {
    const r = summarizeWhatNeedsBen({
      ...ALL_GREEN,
      degraded: ["email-queue: kv-down"],
    });
    expect(r.degraded).toEqual(["email-queue: kv-down"]);
  });
});
