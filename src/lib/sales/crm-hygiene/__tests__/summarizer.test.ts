import { describe, expect, it } from "vitest";

import { composeHygieneDigest } from "../summarizer";
import { runHygieneScan } from "../detectors";
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
    createdate: overrides.createdate ?? "2026-04-01T00:00:00.000Z",
    lastmodifieddate:
      overrides.lastmodifieddate ?? "2026-05-01T00:00:00.000Z",
    daysSinceLastActivity: overrides.daysSinceLastActivity ?? 0,
  };
}

describe("composeHygieneDigest — quiet collapse", () => {
  it("returns null when there are zero findings", () => {
    const findings = runHygieneScan([], NOW);
    expect(
      composeHygieneDigest(findings, {
        forDate: "2026-05-03",
        totalDealsScanned: 0,
      }),
    ).toBeNull();
  });

  it("returns null when scanning healthy deals", () => {
    const findings = runHygieneScan(
      [
        deal({
          dealname: "Buc-ee's — Wholesale",
          dealstage: HUBSPOT.STAGE_PO_RECEIVED,
          amount: 5000,
          lastmodifieddate: "2026-05-02T00:00:00.000Z",
          createdate: "2026-04-25T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(
      composeHygieneDigest(findings, {
        forDate: "2026-05-03",
        totalDealsScanned: 1,
      }),
    ).toBeNull();
  });
});

describe("composeHygieneDigest — happy path", () => {
  it("includes headline with date + total + affected count", () => {
    const findings = runHygieneScan(
      [
        deal({
          id: "d1",
          dealstage: HUBSPOT.STAGE_QUOTE_PO_SENT,
          amount: null,
          createdate: "2026-05-02T00:00:00.000Z",
          lastmodifieddate: "2026-05-02T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    const digest = composeHygieneDigest(findings, {
      forDate: "2026-05-03",
      totalDealsScanned: 200,
    });
    expect(digest).not.toBeNull();
    expect(digest).toContain("CRM Hygiene — 2026-05-03");
    expect(digest).toContain("scanned 200");
    expect(digest).toContain("1 finding");
  });

  it("renders deep links to HubSpot deals", () => {
    const findings = runHygieneScan(
      [
        deal({
          id: "47811234",
          dealname: "Critical Buyer",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          lastmodifieddate: "2026-04-10T00:00:00.000Z", // critical-stale
        }),
      ],
      NOW,
    );
    const digest = composeHygieneDigest(findings, {
      forDate: "2026-05-03",
      totalDealsScanned: 1,
    });
    expect(digest).toContain(
      "https://app.hubspot.com/contacts/44037769/deal/47811234",
    );
    expect(digest).toContain("Critical Buyer");
  });

  it("orders critical findings before warn before info", () => {
    const findings = runHygieneScan(
      [
        // info: duplicate names
        deal({ id: "dup1", dealname: "Same Name Inc" }),
        deal({ id: "dup2", dealname: "Same Name Inc" }),
        // warn: stale (between 1x and 2x threshold)
        deal({
          id: "warn",
          dealname: "Warn Stale",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          lastmodifieddate: "2026-04-22T00:00:00.000Z",
        }),
        // critical: 2x+ threshold stale
        deal({
          id: "crit",
          dealname: "Critical Stale",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          lastmodifieddate: "2026-04-10T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    const digest = composeHygieneDigest(findings, {
      forDate: "2026-05-03",
      totalDealsScanned: 4,
    });
    expect(digest).not.toBeNull();
    const text = digest as string;
    const critIdx = text.indexOf("Critical Stale");
    const warnIdx = text.indexOf("Warn Stale");
    const dupIdx = text.indexOf("Same Name Inc");
    expect(critIdx).toBeGreaterThanOrEqual(0);
    expect(warnIdx).toBeGreaterThan(critIdx);
    if (dupIdx >= 0) {
      expect(dupIdx).toBeGreaterThan(warnIdx);
    }
  });

  it("includes stage label + suggested follow-up per row", () => {
    const findings = runHygieneScan(
      [
        deal({
          id: "d1",
          dealname: "Test Deal",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          lastmodifieddate: "2026-04-10T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    const digest = composeHygieneDigest(findings, {
      forDate: "2026-05-03",
      totalDealsScanned: 1,
    });
    expect(digest).toContain("Sample Shipped");
    expect(digest).toContain("Touch the deal");
  });

  it("respects topN truncation with a 'showing top X of Y' note", () => {
    const deals: PipelineDeal[] = Array.from({ length: 20 }, (_, i) =>
      deal({
        id: `d${i}`,
        dealname: `Distinct Buyer ${i}`,
        dealstage: HUBSPOT.STAGE_QUOTE_PO_SENT,
        amount: null,
        createdate: "2026-05-02T00:00:00.000Z",
        lastmodifieddate: "2026-05-02T00:00:00.000Z",
      }),
    );
    const findings = runHygieneScan(deals, NOW);
    const digest = composeHygieneDigest(findings, {
      forDate: "2026-05-03",
      totalDealsScanned: 20,
      topN: 5,
    });
    expect(digest).not.toBeNull();
    expect(digest).toContain("Showing top 5 of 20");
  });

  it("includes severity counters in summary line", () => {
    const findings = runHygieneScan(
      [
        deal({
          id: "crit",
          dealstage: HUBSPOT.STAGE_SAMPLE_SHIPPED,
          lastmodifieddate: "2026-04-10T00:00:00.000Z", // critical
        }),
        deal({
          id: "warn",
          dealstage: HUBSPOT.STAGE_QUOTE_PO_SENT,
          amount: null,
          createdate: "2026-05-02T00:00:00.000Z",
          lastmodifieddate: "2026-05-02T00:00:00.000Z", // zero-$ warn
        }),
      ],
      NOW,
    );
    const digest = composeHygieneDigest(findings, {
      forDate: "2026-05-03",
      totalDealsScanned: 2,
    });
    expect(digest).toContain("critical");
    expect(digest).toContain("warn");
  });
});
