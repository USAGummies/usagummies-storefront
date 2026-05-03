import { describe, expect, it } from "vitest";

import { renderBriefDiffLine } from "../brief-diff";
import type { BriefSnapshot } from "../brief-snapshot";

function snap(overrides: Partial<BriefSnapshot> = {}): BriefSnapshot {
  return {
    date: "2026-05-02",
    cashUsd: 2500,
    pendingApprovals: 3,
    staleBuyers: 50,
    sampleQueueAwaitingShip: 2,
    sampleQueueShippedAwaitingResponse: 14,
    capturedAt: "2026-05-02T15:00:00.000Z",
    ...overrides,
  };
}

describe("renderBriefDiffLine — happy path", () => {
  it("renders all five bullets when every metric changed", () => {
    const yesterday = snap();
    const today = {
      cashUsd: 2400,
      pendingApprovals: 5,
      staleBuyers: 52,
      sampleQueueAwaitingShip: 1,
      sampleQueueShippedAwaitingResponse: 15,
    };
    const line = renderBriefDiffLine({ today, yesterday });
    expect(line).toContain("vs 2026-05-02");
    expect(line).toContain("-$100.00 cash");
    expect(line).toContain("+2 approvals");
    expect(line).toContain("+2 stale buyers");
    expect(line).toContain("-1 sample awaiting ship");
    expect(line).toContain("+1 sample awaiting reply");
  });

  it("uses singular for diffs of magnitude 1", () => {
    const line = renderBriefDiffLine({
      today: {
        cashUsd: 2500,
        pendingApprovals: 4,
        staleBuyers: 51,
        sampleQueueAwaitingShip: null,
        sampleQueueShippedAwaitingResponse: null,
      },
      yesterday: snap(),
    });
    expect(line).toContain("+1 approval");
    expect(line).not.toContain("+1 approvals");
    expect(line).toContain("+1 stale buyer");
    expect(line).not.toContain("+1 stale buyers");
  });

  it("renders + sign for positive cash, - for negative", () => {
    const positive = renderBriefDiffLine({
      today: {
        cashUsd: 2600,
        pendingApprovals: 3,
        staleBuyers: 50,
        sampleQueueAwaitingShip: 2,
        sampleQueueShippedAwaitingResponse: 14,
      },
      yesterday: snap(),
    });
    expect(positive).toContain("+$100.00 cash");

    const negative = renderBriefDiffLine({
      today: {
        cashUsd: 2400,
        pendingApprovals: 3,
        staleBuyers: 50,
        sampleQueueAwaitingShip: 2,
        sampleQueueShippedAwaitingResponse: 14,
      },
      yesterday: snap(),
    });
    expect(negative).toContain("-$100.00 cash");
  });
});

describe("renderBriefDiffLine — quiet collapse", () => {
  it("returns null when nothing changed", () => {
    const yesterday = snap();
    const today = {
      cashUsd: yesterday.cashUsd,
      pendingApprovals: yesterday.pendingApprovals,
      staleBuyers: yesterday.staleBuyers,
      sampleQueueAwaitingShip: yesterday.sampleQueueAwaitingShip,
      sampleQueueShippedAwaitingResponse:
        yesterday.sampleQueueShippedAwaitingResponse,
    };
    expect(renderBriefDiffLine({ today, yesterday })).toBeNull();
  });

  it("ignores cash deltas under the $5 floor (filters float noise)", () => {
    const line = renderBriefDiffLine({
      today: {
        cashUsd: 2502.5,
        pendingApprovals: 3,
        staleBuyers: 50,
        sampleQueueAwaitingShip: 2,
        sampleQueueShippedAwaitingResponse: 14,
      },
      yesterday: snap({ cashUsd: 2500 }),
    });
    expect(line).toBeNull(); // $2.50 delta is below the $5 floor
  });

  it("renders cash delta at exactly $5 (boundary)", () => {
    const line = renderBriefDiffLine({
      today: {
        cashUsd: 2505,
        pendingApprovals: 3,
        staleBuyers: 50,
        sampleQueueAwaitingShip: 2,
        sampleQueueShippedAwaitingResponse: 14,
      },
      yesterday: snap({ cashUsd: 2500 }),
    });
    expect(line).toContain("+$5.00 cash");
  });
});

describe("renderBriefDiffLine — null suppression (no fabrication)", () => {
  it("suppresses cash bullet when today is null", () => {
    const line = renderBriefDiffLine({
      today: {
        cashUsd: null,
        pendingApprovals: 5,
        staleBuyers: 50,
        sampleQueueAwaitingShip: 2,
        sampleQueueShippedAwaitingResponse: 14,
      },
      yesterday: snap(),
    });
    expect(line).not.toContain("cash");
    expect(line).toContain("+2 approvals");
  });

  it("suppresses cash bullet when yesterday is null", () => {
    const line = renderBriefDiffLine({
      today: {
        cashUsd: 2500,
        pendingApprovals: 5,
        staleBuyers: 50,
        sampleQueueAwaitingShip: 2,
        sampleQueueShippedAwaitingResponse: 14,
      },
      yesterday: snap({ cashUsd: null }),
    });
    expect(line).not.toContain("cash");
  });

  it("suppresses staleBuyers bullet when either side is null", () => {
    const line = renderBriefDiffLine({
      today: {
        cashUsd: 2500,
        pendingApprovals: 4,
        staleBuyers: null,
        sampleQueueAwaitingShip: 2,
        sampleQueueShippedAwaitingResponse: 14,
      },
      yesterday: snap(),
    });
    expect(line).not.toContain("stale");
    expect(line).toContain("+1 approval");
  });

  it("returns null when ALL bullets are suppressed", () => {
    const line = renderBriefDiffLine({
      today: {
        cashUsd: null,
        pendingApprovals: 3,
        staleBuyers: null,
        sampleQueueAwaitingShip: null,
        sampleQueueShippedAwaitingResponse: null,
      },
      yesterday: snap(),
    });
    expect(line).toBeNull();
  });
});
