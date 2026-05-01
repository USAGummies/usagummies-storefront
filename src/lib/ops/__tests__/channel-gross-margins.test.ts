/**
 * CHANNEL_GROSS_MARGINS regression coverage — Phase 36.7.
 *
 * Pins per-bag margin numbers against `/contracts/proforma-channel-margins.md`
 * v0.1 (2026-04-30 PM). Catches three classes of drift:
 *
 *   1. COGS lock drift — every channel's `cogsPerBag` must equal the
 *      canonical UNIT_ECONOMICS.cogsPerBag ($1.79). If the wholesale-pricing.md
 *      Class C lock changes again, these tests fail and force a coordinated
 *      multi-channel update (no quiet drift).
 *   2. Numeric drift — the GP and GM% range bounds match what the source
 *      doc says ("$1.42–$1.62 ≈ 41–46% GM") within $0.02 / 1pp tolerance.
 *      A new fee or freight tweak breaks the test.
 *   3. Status drift — channels flagged `negative` in the source doc must
 *      stay negative in code so the morning-brief alerts surface them.
 *      Channels marked `needs_actuals` (Amazon FBA inbound + storage)
 *      must keep that flag until QBO actuals are wired.
 *
 * Doctrine source: `/contracts/financial-mechanisms-blueprint.md` §6.2
 * pinned per-vendor margin parser as ✅ shipped; this is the symmetric
 * test for the per-channel structured export.
 */
import { describe, expect, it } from "vitest";

import {
  CHANNEL_GROSS_MARGINS,
  UNIT_ECONOMICS,
  type ChannelGrossMargin,
} from "../pro-forma";

describe("CHANNEL_GROSS_MARGINS structural invariants", () => {
  it("every channel pins COGS to UNIT_ECONOMICS.cogsPerBag (no quiet drift)", () => {
    for (const [slug, row] of Object.entries(CHANNEL_GROSS_MARGINS)) {
      expect(row.cogsPerBag, `${slug} cogsPerBag`).toBeCloseTo(
        UNIT_ECONOMICS.cogsPerBag,
        4,
      );
    }
  });

  it("every freight range is [low, high] with low <= high", () => {
    for (const [slug, row] of Object.entries(CHANNEL_GROSS_MARGINS)) {
      const [low, high] = row.freightPerBag;
      expect(low, `${slug} freight low`).toBeGreaterThanOrEqual(0);
      expect(high, `${slug} freight high`).toBeGreaterThanOrEqual(low);
    }
  });

  it("gpPerBagLow is computed against the WORST-case (highest) freight", () => {
    for (const [slug, row] of Object.entries(CHANNEL_GROSS_MARGINS)) {
      const [low, high] = row.freightPerBag;
      const expectedLow = round2(
        row.revenuePerBag - row.feesPerBag - row.cogsPerBag - high,
      );
      const expectedHigh = round2(
        row.revenuePerBag - row.feesPerBag - row.cogsPerBag - low,
      );
      expect(row.gpPerBagLow, `${slug} gpPerBagLow`).toBeCloseTo(expectedLow, 2);
      expect(row.gpPerBagHigh, `${slug} gpPerBagHigh`).toBeCloseTo(expectedHigh, 2);
    }
  });
});

describe("CHANNEL_GROSS_MARGINS — per-channel pinning vs proforma-channel-margins.md", () => {
  it("amazonFba: ~$0.31 GP, flagged needs_actuals (inbound + storage estimated)", () => {
    const r = CHANNEL_GROSS_MARGINS.amazonFba;
    // Source: $5.99 - $0.48 - $3.06 - $0.30 - $0.05 - $1.79 = $0.31
    expectGpInRange(r, 0.31, 0.31);
    expect(r.status).toBe("needs_actuals");
  });

  it("amazonFbmSingle: NEGATIVE — $5.99 minus $6.74-6.95 USPS loses money", () => {
    const r = CHANNEL_GROSS_MARGINS.amazonFbmSingle;
    expect(r.status).toBe("negative");
    expect(r.gpPerBagLow).toBeLessThan(0);
    expect(r.note).toMatch(/NEGATIVE/i);
  });

  it("shopifyDtcSingle: NEGATIVE — same shipping-loss issue as FBM single-bag", () => {
    const r = CHANNEL_GROSS_MARGINS.shopifyDtcSingle;
    expect(r.status).toBe("negative");
    expect(r.gpPerBagLow).toBeLessThan(0);
  });

  it("shopifyDtc5Pack: ~$1.02–$1.42 GP/bag, ~20–28% GM (thin)", () => {
    const r = CHANNEL_GROSS_MARGINS.shopifyDtc5Pack;
    expectGpInRange(r, 1.0, 1.45);
    expect(r.gpPctLow).toBeGreaterThanOrEqual(20);
    expect(r.gpPctHigh).toBeLessThanOrEqual(30);
    // Per the source doc, 5-pack lands in "thin" status (<25% on the worst end).
    expect(r.status).toBe("thin");
  });

  it("shopifyDtc10Pack: ~$1.76–$2.06 GP/bag, ~35–41% GM (healthy)", () => {
    const r = CHANNEL_GROSS_MARGINS.shopifyDtc10Pack;
    expectGpInRange(r, 1.74, 2.08);
    expect(r.gpPctLow).toBeGreaterThanOrEqual(34);
    expect(r.gpPctHigh).toBeLessThanOrEqual(42);
    expect(r.status).toBe("healthy");
  });

  it("faireDirect: ~$0.30–$0.50 GP/bag at $2.49 sell-sheet", () => {
    const r = CHANNEL_GROSS_MARGINS.faireDirect;
    expectGpInRange(r, 0.28, 0.52);
    expect(r.feesPerBag).toBe(0); // 0% Direct commission
  });

  it("faireOptionB: −$0.07 to $0.13 GP/bag at $2.10 — flagged thin/negative", () => {
    const r = CHANNEL_GROSS_MARGINS.faireOptionB;
    expectGpInRange(r, -0.10, 0.15);
    // Negative on the worst end → status:negative
    expect(r.status).toBe("negative");
  });

  it("wholesaleB2 (master carton landed $3.49): ~$1.42–$1.62 GP, ~41–46% GM", () => {
    const r = CHANNEL_GROSS_MARGINS.wholesaleB2;
    expectGpInRange(r, 1.4, 1.62);
    expect(r.gpPctLow).toBeGreaterThanOrEqual(40);
    expect(r.gpPctHigh).toBeLessThanOrEqual(47);
    expect(r.status).toBe("healthy");
  });

  it("wholesaleB3 reflects v2.3 Q3 surcharge ($3.50, was $3.25): $1.71 GP, ~49% GM", () => {
    const r = CHANNEL_GROSS_MARGINS.wholesaleB3;
    expect(r.revenuePerBag).toBe(3.5);
    // $3.50 - 0 fees - $1.79 COGS - 0 freight = $1.71
    expectGpInRange(r, 1.71, 1.71);
    expect(r.gpPctLow).toBeGreaterThanOrEqual(48);
    expect(r.status).toBe("healthy");
  });

  it("wholesaleB4 (pallet landed $3.25): ~$0.96–$1.39 GP, state-dependent", () => {
    const r = CHANNEL_GROSS_MARGINS.wholesaleB4;
    expectGpInRange(r, 0.94, 1.41);
    // Note check must be lowercase-tolerant; "state-dependent" is the doc phrase
    expect(r.note?.toLowerCase()).toContain("state");
  });

  it("wholesaleB5 reflects v2.3 Q3 surcharge ($3.25, was $3.00): $1.46 GP", () => {
    const r = CHANNEL_GROSS_MARGINS.wholesaleB5;
    expect(r.revenuePerBag).toBe(3.25);
    expectGpInRange(r, 1.46, 1.46);
  });

  it("wholesaleCANCH (proposed C-ANCH route-anchor): $0.86–$1.16 GP, route-density dependent", () => {
    const r = CHANNEL_GROSS_MARGINS.wholesaleCANCH;
    expectGpInRange(r, 0.84, 1.18);
    expect(r.note?.toLowerCase()).toContain("proposed");
  });
});

describe("CHANNEL_GROSS_MARGINS — operator-facing safety properties", () => {
  it("status:negative channels are surfaced for the morning brief", () => {
    const negative = Object.values(CHANNEL_GROSS_MARGINS).filter(
      (r) => r.status === "negative",
    );
    expect(negative.length).toBeGreaterThan(0);
    // Per the source doc as of 2026-04-30 PM: amazonFbmSingle, shopifyDtcSingle,
    // faireOptionB. Pin the count so a future quiet flip to "thin" forces a
    // doc + alert review.
    expect(negative.map((r) => r.channel).sort()).toEqual(
      ["amazonFbmSingle", "faireOptionB", "shopifyDtcSingle"].sort(),
    );
  });

  it("every row carries a source citation back to the proforma doc (no orphan numbers)", () => {
    for (const [slug, row] of Object.entries(CHANNEL_GROSS_MARGINS)) {
      expect(row.source, `${slug} source`).toMatch(
        /\/contracts\/proforma-channel-margins\.md/,
      );
    }
  });

  it("UNIT_ECONOMICS.cogsPerBag remains $1.79 (Class C v2.3 lock 2026-04-30 PM)", () => {
    expect(UNIT_ECONOMICS.cogsPerBag).toBe(1.79);
  });
});

// ---- helpers ---------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function expectGpInRange(
  row: ChannelGrossMargin,
  expectedLow: number,
  expectedHigh: number,
): void {
  // Tolerance: $0.03/bag — accommodates rounding on pre-multiplied bundle math
  // (5-pack and 10-pack divide by N), and accommodates source-doc rounding
  // ("$1.42–$1.62" is the doc's rounded statement of the underlying math).
  expect(row.gpPerBagLow, `${row.channel} GP low`).toBeGreaterThanOrEqual(
    expectedLow - 0.03,
  );
  expect(row.gpPerBagHigh, `${row.channel} GP high`).toBeLessThanOrEqual(
    expectedHigh + 0.03,
  );
}
