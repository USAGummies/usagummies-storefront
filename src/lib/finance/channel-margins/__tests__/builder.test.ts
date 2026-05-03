import { describe, expect, it } from "vitest";

import {
  buildChannelMarginsTable,
  FORWARD_COGS_PER_BAG_USD,
  MARGIN_FLOOR_USD,
} from "../builder";

describe("buildChannelMarginsTable", () => {
  it("returns 10 channels in canonical order", () => {
    const t = buildChannelMarginsTable();
    expect(t.rows).toHaveLength(10);
    expect(t.rows[0].channel).toBe("amazon-fba");
    expect(t.rows[t.rows.length - 1].channel).toBe("trade-show-booth");
  });

  it("every row has gross > 0 and uses canonical COGS", () => {
    const t = buildChannelMarginsTable();
    for (const row of t.rows) {
      expect(row.grossRevenuePerBagUsd).toBeGreaterThan(0);
      expect(row.cogsPerBagUsd).toBe(FORWARD_COGS_PER_BAG_USD);
    }
  });

  it("Amazon FBM is the healthiest channel ($8.99 - 15% referral - $1.557 COGS - $0.20 ship)", () => {
    const t = buildChannelMarginsTable();
    expect(t.summary.healthiestChannel).toBe("amazon-fbm");
    const fbm = t.rows.find((r) => r.channel === "amazon-fbm");
    // 8.99 - (8.99*0.15) - 1.557 - 0.20 = 8.99 - 1.349 - 1.557 - 0.20 = 5.88
    expect(fbm?.grossMarginPerBagUsd).toBeCloseTo(5.88, 1);
  });

  it("distributor delivered ($2.10) is below the $2.12 margin floor", () => {
    const t = buildChannelMarginsTable();
    const dist = t.rows.find((r) => r.channel === "distributor-delivered");
    expect(dist?.belowMarginFloor).toBe(true);
  });

  it("trade-show booth ($3.25 with $0 shipping/fees) margin = $1.69 — below floor", () => {
    const t = buildChannelMarginsTable();
    const booth = t.rows.find((r) => r.channel === "trade-show-booth");
    // $3.25 - $1.557 (cogs) - $0 shipping - $0 fees = $1.693
    expect(booth?.grossMarginPerBagUsd).toBeCloseTo(1.69, 1);
    // Below $2.12 floor — confirms the show special needs review
    // (fee + shipping allocation to marketing only works if revenue
    // covers cost first).
    expect(booth?.belowMarginFloor).toBe(true);
  });

  it("computes Amazon FBA fee load correctly (15% referral + $3.74 FBA)", () => {
    const t = buildChannelMarginsTable();
    const fba = t.rows.find((r) => r.channel === "amazon-fba");
    // 8.99 * 0.15 + 3.74 = 1.3485 + 3.74 = $5.09 (rounded)
    expect(fba?.channelFeesPerBagUsd).toBeCloseTo(5.09, 2);
    // Net = 8.99 - 5.09 = $3.90
    expect(fba?.netRevenuePerBagUsd).toBeCloseTo(3.9, 2);
    // Margin = 3.90 - 1.557 - 0 = $2.34
    expect(fba?.grossMarginPerBagUsd).toBeCloseTo(2.34, 2);
  });

  it("Faire reorder shape uses 25% commission and reorder buyer-pays freight", () => {
    const t = buildChannelMarginsTable();
    const faire = t.rows.find((r) => r.channel === "faire");
    // 3.49 * 0.25 = $0.8725 fee
    expect(faire?.channelFeesPerBagUsd).toBeCloseTo(0.87, 2);
    // Net = 3.49 - 0.87 = $2.62
    expect(faire?.netRevenuePerBagUsd).toBeCloseTo(2.62, 2);
    // Margin = 2.62 - 1.557 - 0 = $1.06 → below floor
    expect(faire?.belowMarginFloor).toBe(true);
  });

  it("wholesale-pallet-buyer-pays at $3.25 with no shipping is HIGHER margin than landed", () => {
    const t = buildChannelMarginsTable();
    const buyerPays = t.rows.find(
      (r) => r.channel === "wholesale-pallet-buyer-pays",
    );
    const landed = t.rows.find(
      (r) => r.channel === "wholesale-pallet-landed",
    );
    expect(buyerPays?.grossMarginPerBagUsd).toBeGreaterThan(
      landed?.grossMarginPerBagUsd ?? 0,
    );
  });

  it("override grossRevenuePerBag flips below-floor flags accordingly", () => {
    const t = buildChannelMarginsTable({
      overrides: {
        grossRevenuePerBag: { "distributor-delivered": 4.5 },
      },
    });
    const dist = t.rows.find((r) => r.channel === "distributor-delivered");
    expect(dist?.grossRevenuePerBagUsd).toBe(4.5);
    expect(dist?.belowMarginFloor).toBe(false);
  });

  it("override channelFeesPerBag works (e.g. Faire reorder rate 15%)", () => {
    const t = buildChannelMarginsTable({
      overrides: {
        channelFeesPerBag: { faire: 3.49 * 0.15 },
      },
    });
    const faire = t.rows.find((r) => r.channel === "faire");
    expect(faire?.channelFeesPerBagUsd).toBeCloseTo(0.52, 2);
  });

  it("summary picks the lowest-margin channel as leastHealthy", () => {
    const t = buildChannelMarginsTable();
    expect(t.summary.leastHealthyChannel).toBe("distributor-delivered");
  });

  it("source citations include the canonical doctrine refs", () => {
    const t = buildChannelMarginsTable();
    const ids = t.sources.map((s) => s.system);
    expect(ids).toContain("doctrine:wholesale-pricing.md");
    expect(ids).toContain("doctrine:daily-pnl.ts");
    expect(ids).toContain("doctrine:off-grid-pricing-escalation.md");
  });

  it("marginFloorUsd matches doctrine constant", () => {
    const t = buildChannelMarginsTable();
    expect(t.marginFloorUsd).toBe(MARGIN_FLOOR_USD);
  });

  it("estimate flags surface for channels with non-actual data", () => {
    const t = buildChannelMarginsTable();
    const fba = t.rows.find((r) => r.channel === "amazon-fba");
    expect(fba?.unavailable.channelFees).toBe(true);
    expect(fba?.unavailable.reason).toContain("SP-API settlement");

    // Wholesale rows are doctrine-locked — no estimate flag.
    const b2 = t.rows.find((r) => r.channel === "wholesale-master-landed");
    expect(b2?.unavailable.channelFees).toBe(false);
    expect(b2?.unavailable.shipping).toBe(false);
  });
});
