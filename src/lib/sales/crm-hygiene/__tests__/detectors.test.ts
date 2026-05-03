import { describe, expect, it } from "vitest";

import {
  detectClosedWithOpenAmount,
  detectDuplicateNames,
  detectMissingFields,
  detectStaleDeals,
  detectStuckInStage,
  detectZeroDollarDeals,
  runHygieneScan,
} from "../detectors";
import { HUBSPOT } from "../../../ops/hubspot-client";
import type { PipelineDeal } from "../../../ops/hubspot-client";

const NOW = new Date("2026-05-03T15:00:00.000Z");

function deal(overrides: Partial<PipelineDeal> = {}): PipelineDeal {
  return {
    id: overrides.id ?? `deal-${Math.random()}`,
    dealname: overrides.dealname ?? "Test Buyer — Wholesale",
    dealstage: overrides.dealstage ?? HUBSPOT.STAGE_LEAD,
    amount: overrides.amount ?? null,
    closedate: overrides.closedate ?? null,
    createdate:
      overrides.createdate ?? "2026-04-01T00:00:00.000Z",
    lastmodifieddate:
      overrides.lastmodifieddate ?? "2026-05-01T00:00:00.000Z",
    daysSinceLastActivity: overrides.daysSinceLastActivity ?? 0,
  };
}

describe("detectMissingFields", () => {
  it("flags deals with empty dealname", () => {
    const findings = detectMissingFields([
      deal({ id: "d1", dealname: "" }),
      deal({ id: "d2", dealname: "Valid name" }),
      deal({ id: "d3", dealname: "   " }),
    ]);
    expect(findings.map((f) => f.dealId).sort()).toEqual(["d1", "d3"]);
    expect(findings[0].kind).toBe("missing-field");
    expect(findings[0].field).toBe("dealname");
  });

  it("returns empty when all deals have names", () => {
    expect(
      detectMissingFields([deal({ dealname: "Buc-ee's" })]),
    ).toEqual([]);
  });
});

describe("detectStaleDeals", () => {
  it("flags an old Sample Shipped deal (threshold 7d)", () => {
    const findings = detectStaleDeals(
      [
        deal({
          id: "d1",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          lastmodifieddate: "2026-04-20T00:00:00.000Z", // 13 days ago
        }),
      ],
      NOW,
    );
    expect(findings.length).toBe(1);
    expect(findings[0].daysSinceLastActivity).toBe(13);
    expect(findings[0].severity).toBe("warn");
  });

  it("escalates to critical at 2x threshold", () => {
    const findings = detectStaleDeals(
      [
        deal({
          id: "d1",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED, // threshold 7
          lastmodifieddate: "2026-04-15T00:00:00.000Z", // 18d ago, > 14d (2x)
        }),
      ],
      NOW,
    );
    expect(findings[0].severity).toBe("critical");
  });

  it("does NOT flag terminal-stage deals (Closed Won/Lost/On Hold)", () => {
    const findings = detectStaleDeals(
      [
        deal({
          id: "won",
          dealstage: HUBSPOT.STAGE_CLOSED_WON,
          lastmodifieddate: "2025-01-01T00:00:00.000Z",
        }),
        deal({
          id: "lost",
          dealstage: HUBSPOT.STAGE_CLOSED_LOST,
          lastmodifieddate: "2025-01-01T00:00:00.000Z",
        }),
        deal({
          id: "hold",
          dealstage: HUBSPOT.STAGE_ON_HOLD,
          lastmodifieddate: "2025-01-01T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(findings).toEqual([]);
  });

  it("respects per-stage thresholds", () => {
    // Lead threshold = 21d, so a 14d-stale Lead is NOT flagged
    const findings = detectStaleDeals(
      [
        deal({
          id: "d1",
          dealstage: HUBSPOT.STAGE_LEAD,
          lastmodifieddate: "2026-04-19T00:00:00.000Z", // 14d ago
        }),
      ],
      NOW,
    );
    expect(findings).toEqual([]);
  });
});

describe("detectZeroDollarDeals", () => {
  it("flags a Quote/PO Sent deal with null amount", () => {
    const findings = detectZeroDollarDeals([
      deal({
        id: "d1",
        dealstage: HUBSPOT.STAGE_QUOTE_PO_SENT,
        amount: null,
      }),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0].field).toBe("amount");
    expect(findings[0].severity).toBe("warn");
  });

  it("flags a deal in revenue stage with amount 0", () => {
    const findings = detectZeroDollarDeals([
      deal({
        id: "d1",
        dealstage: HUBSPOT.STAGE_PO_RECEIVED,
        amount: 0,
      }),
    ]);
    expect(findings.length).toBe(1);
  });

  it("does NOT flag early-stage deals (Lead, Contacted, etc)", () => {
    const findings = detectZeroDollarDeals([
      deal({ id: "d1", dealstage: HUBSPOT.STAGE_LEAD, amount: null }),
      deal({ id: "d2", dealstage: HUBSPOT.STAGE_RESPONDED, amount: 0 }),
      deal({
        id: "d3",
        dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
        amount: null,
      }),
    ]);
    expect(findings).toEqual([]);
  });

  it("does NOT flag revenue-stage deals with positive amount", () => {
    const findings = detectZeroDollarDeals([
      deal({
        id: "d1",
        dealstage: HUBSPOT.STAGE_PO_RECEIVED,
        amount: 5000,
      }),
    ]);
    expect(findings).toEqual([]);
  });
});

describe("detectStuckInStage", () => {
  it("flags a Sample Requested deal stuck for 16d (max 14)", () => {
    const findings = detectStuckInStage(
      [
        deal({
          id: "d1",
          dealstage: HUBSPOT.STAGE_SAMPLE_REQUESTED,
          createdate: "2026-04-15T00:00:00.000Z",
          lastmodifieddate: "2026-04-17T00:00:00.000Z", // 16d ago
        }),
      ],
      NOW,
    );
    expect(findings.length).toBe(1);
    expect(findings[0].kind).toBe("stuck-in-stage");
  });

  it("uses createdate (not lastmod) for early stages", () => {
    // For a Lead, dwell is measured from createdate. Even with a recent
    // lastmod, an old createdate triggers stuck-in-stage when dwell > 60.
    const findings = detectStuckInStage(
      [
        deal({
          id: "d1",
          dealstage: HUBSPOT.STAGE_LEAD,
          createdate: "2026-02-15T00:00:00.000Z", // ~77d ago
          lastmodifieddate: "2026-05-02T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(findings.length).toBe(1);
    expect(findings[0].daysSinceLastActivity).toBeGreaterThanOrEqual(60);
  });

  it("escalates to critical at 1.5x dwell", () => {
    // Sample Shipped max-dwell = 30. 1.5x = 45.
    const findings = detectStuckInStage(
      [
        deal({
          id: "d1",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          createdate: "2026-03-01T00:00:00.000Z",
          lastmodifieddate: "2026-03-01T00:00:00.000Z", // 63d
        }),
      ],
      NOW,
    );
    expect(findings[0].severity).toBe("critical");
  });

  it("does NOT flag terminal stages", () => {
    const findings = detectStuckInStage(
      [
        deal({
          id: "won",
          dealstage: HUBSPOT.STAGE_CLOSED_WON,
          lastmodifieddate: "2024-01-01T00:00:00.000Z",
          createdate: "2024-01-01T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(findings).toEqual([]);
  });

  it("does NOT flag deals with no per-stage dwell config", () => {
    const findings = detectStuckInStage(
      [
        deal({
          id: "d1",
          dealstage: HUBSPOT.STAGE_REORDER,
          lastmodifieddate: "2025-01-01T00:00:00.000Z",
          createdate: "2025-01-01T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(findings).toEqual([]);
  });
});

describe("detectDuplicateNames", () => {
  it("flags two deals with same normalized name", () => {
    // Apostrophe-s is stripped, dashes/punctuation collapsed.
    const findings = detectDuplicateNames([
      deal({ id: "d1", dealname: "Buc-ee's — Wholesale" }),
      deal({ id: "d2", dealname: "Buc-ee  -  Wholesale" }),
    ]);
    expect(findings.length).toBe(2);
    expect(findings.every((f) => f.kind === "duplicate-name")).toBe(true);
    expect(findings[0].duplicateOf).toContain(findings[1].dealId);
  });

  it("does NOT flag distinct names", () => {
    const findings = detectDuplicateNames([
      deal({ id: "d1", dealname: "Buc-ee's" }),
      deal({ id: "d2", dealname: "Wegmans" }),
      deal({ id: "d3", dealname: "Bass Pro Shops" }),
    ]);
    expect(findings).toEqual([]);
  });

  it("ignores empty names (caught by detectMissingFields)", () => {
    const findings = detectDuplicateNames([
      deal({ id: "d1", dealname: "" }),
      deal({ id: "d2", dealname: "" }),
    ]);
    expect(findings).toEqual([]);
  });
});

describe("detectClosedWithOpenAmount", () => {
  it("flags Closed Lost deals that still have non-zero amount", () => {
    const findings = detectClosedWithOpenAmount([
      deal({
        id: "d1",
        dealstage: HUBSPOT.STAGE_CLOSED_LOST,
        amount: 1500,
      }),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0].kind).toBe("closed-with-open-amount");
  });

  it("does NOT flag Closed Lost with zero/null amount", () => {
    const findings = detectClosedWithOpenAmount([
      deal({
        id: "d1",
        dealstage: HUBSPOT.STAGE_CLOSED_LOST,
        amount: 0,
      }),
      deal({
        id: "d2",
        dealstage: HUBSPOT.STAGE_CLOSED_LOST,
        amount: null,
      }),
    ]);
    expect(findings).toEqual([]);
  });

  it("does NOT flag Closed Won (revenue is real money)", () => {
    const findings = detectClosedWithOpenAmount([
      deal({
        id: "d1",
        dealstage: HUBSPOT.STAGE_CLOSED_WON,
        amount: 5000,
      }),
    ]);
    expect(findings).toEqual([]);
  });
});

describe("runHygieneScan — composite", () => {
  it("aggregates findings across all detectors", () => {
    const result = runHygieneScan(
      [
        deal({ id: "missing", dealname: "" }),
        deal({
          id: "stale",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          lastmodifieddate: "2026-04-15T00:00:00.000Z",
        }),
        deal({
          id: "zero",
          dealstage: HUBSPOT.STAGE_PO_RECEIVED,
          amount: null,
          lastmodifieddate: "2026-05-01T00:00:00.000Z",
        }),
        deal({
          id: "won",
          dealstage: HUBSPOT.STAGE_CLOSED_WON,
          amount: 5000,
        }),
      ],
      NOW,
    );
    expect(result.total).toBeGreaterThan(0);
    expect(result.byKind["missing-field"].length).toBe(1);
    expect(result.byKind["stale-deal"].length).toBeGreaterThan(0);
    expect(result.byKind["zero-dollar"].length).toBe(1);
    expect(result.affectedDealIds.length).toBeGreaterThan(0);
  });

  it("orders topFindings by severity (critical first)", () => {
    const result = runHygieneScan(
      [
        // Critical-stale (2x threshold)
        deal({
          id: "crit",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          lastmodifieddate: "2026-04-10T00:00:00.000Z", // 23d > 2x7
        }),
        // Warn-stale
        deal({
          id: "warn",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          lastmodifieddate: "2026-04-22T00:00:00.000Z", // 11d > 7
        }),
        // Info-only (duplicate)
        deal({
          id: "dup1",
          dealname: "Same Name Inc",
        }),
        deal({
          id: "dup2",
          dealname: "Same Name Inc",
        }),
      ],
      NOW,
    );
    const critIdx = result.topFindings.findIndex((f) => f.severity === "critical");
    const infoIdx = result.topFindings.findIndex((f) => f.severity === "info");
    expect(critIdx).toBeGreaterThanOrEqual(0);
    if (infoIdx >= 0) {
      expect(critIdx).toBeLessThan(infoIdx);
    }
  });

  it("respects topN limit", () => {
    // 30 zero-dollar findings, each with a UNIQUE name to avoid
    // tripping detectDuplicateNames; fresh dates to skip staleness +
    // stuck-in-stage. So total = 30 (one finding per deal).
    const deals: PipelineDeal[] = Array.from({ length: 30 }, (_, i) =>
      deal({
        id: `d${i}`,
        dealname: `Distinct Buyer ${i}`,
        dealstage: HUBSPOT.STAGE_QUOTE_PO_SENT,
        amount: null,
        createdate: "2026-05-02T00:00:00.000Z",
        lastmodifieddate: "2026-05-02T00:00:00.000Z",
      }),
    );
    const result = runHygieneScan(deals, NOW, { topN: 5 });
    expect(result.topFindings.length).toBe(5);
    expect(result.total).toBe(30);
  });

  it("reports zero findings when input is healthy", () => {
    const healthy: PipelineDeal[] = [
      deal({
        id: "d1",
        dealname: "Buc-ee's — Wholesale",
        dealstage: HUBSPOT.STAGE_PO_RECEIVED,
        amount: 5000,
        lastmodifieddate: "2026-05-02T00:00:00.000Z",
        createdate: "2026-04-25T00:00:00.000Z",
      }),
    ];
    const result = runHygieneScan(healthy, NOW);
    expect(result.total).toBe(0);
    expect(result.topFindings).toEqual([]);
  });
});
