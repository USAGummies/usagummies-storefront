/**
 * Slack `shipping today` card renderer coverage.
 *
 * Pins:
 *   - Empty / clean → green clean copy.
 *   - Stats fields surface every count + per-carrier wallet balances.
 *   - Wallet alert section appears only when alerts exist (red banner).
 *   - Exhausted retries fire EXHAUSTED warning in brief.
 *   - Pending retries section appears when queue non-empty.
 *   - Read-only context note ("no label is bought from this card") present.
 *   - Dashboard URL is /ops/shipping.
 *   - Wallet fetch error renders ":warning: error" text not "$NaN".
 *   - Degraded list surfaces.
 */
import { describe, expect, it } from "vitest";

import { renderShippingTodayCard } from "../slack-shipping-today-card";
import type { ShippingTodaySummary } from "../shipping-today";

function summary(
  overrides: Partial<ShippingTodaySummary> = {},
): ShippingTodaySummary {
  return {
    generatedAt: "2026-05-02T18:00:00.000Z",
    retryQueue: { total: 0, pending: 0, exhausted: 0, oldestPending: [] },
    pendingApprovals: 0,
    oldestPendingApprovals: [],
    wallet: [],
    walletAlerts: [],
    posture: "green",
    degraded: [],
    ...overrides,
  };
}

describe("renderShippingTodayCard", () => {
  it("clean posture → green clean copy", () => {
    const card = renderShippingTodayCard({ summary: summary() });
    expect(card.text).toMatch(/clean/);
    expect(JSON.stringify(card.blocks)).toMatch(/Clean shipping posture/);
    expect(JSON.stringify(card.blocks)).toMatch(/🟢/);
  });

  it("stats fields surface counts + wallet balances per carrier", () => {
    const card = renderShippingTodayCard({
      summary: summary({
        retryQueue: { total: 5, pending: 3, exhausted: 2, oldestPending: [] },
        pendingApprovals: 4,
        wallet: [
          { carrierCode: "stamps_com", balanceUsd: 42 },
          { carrierCode: "ups_walleted", balanceUsd: 87.5 },
        ],
        walletAlerts: [],
        posture: "yellow",
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("Retry pending");
    expect(blob).toContain("\\n3");
    expect(blob).toContain("Retry exhausted");
    expect(blob).toContain("\\n2");
    expect(blob).toContain("Pending approvals");
    expect(blob).toContain("\\n4");
    expect(blob).toContain("$42.00");
    expect(blob).toContain("$87.50");
  });

  it("wallet alert section appears only when alerts exist", () => {
    const without = renderShippingTodayCard({ summary: summary() });
    expect(JSON.stringify(without.blocks)).not.toMatch(/Wallet alerts\\n•/);
    const withAlert = renderShippingTodayCard({
      summary: summary({
        posture: "red",
        wallet: [{ carrierCode: "stamps_com", balanceUsd: 5 }],
        walletAlerts: [{ carrierCode: "stamps_com", balanceUsd: 5 }],
      }),
    });
    const blob = JSON.stringify(withAlert.blocks);
    expect(blob).toMatch(/Wallet alerts/);
    expect(blob).toContain("$5.00");
  });

  it("exhausted retry fires EXHAUSTED copy + 🔴 posture", () => {
    const card = renderShippingTodayCard({
      summary: summary({
        retryQueue: {
          total: 1,
          pending: 0,
          exhausted: 1,
          oldestPending: [],
        },
        posture: "red",
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/exhausted/i);
    expect(blob).toMatch(/🔴/);
  });

  it("oldest pending retries section appears with reason + attempts + age", () => {
    const card = renderShippingTodayCard({
      summary: summary({
        retryQueue: {
          total: 1,
          pending: 1,
          exhausted: 0,
          oldestPending: [
            {
              reason: "slack-post: not_in_channel",
              enqueuedAt: "2026-05-02T17:55:00.000Z",
              attempts: 2,
              ageMinutes: 5,
            },
          ],
        },
        posture: "yellow",
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("not_in_channel");
    expect(blob).toMatch(/2 attempts/);
    expect(blob).toMatch(/5m old/);
  });

  it("oldest pending approvals section appears when present", () => {
    const card = renderShippingTodayCard({
      summary: summary({
        pendingApprovals: 1,
        oldestPendingApprovals: [
          {
            id: "a-shipping",
            actorAgentId: "ops",
            action: "shipment.create",
            createdAt: "2026-04-29T18:00:00.000Z",
            ageDays: 3,
          },
        ],
        posture: "red",
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/Oldest pending approvals/);
    expect(blob).toContain("a-shipping");
    expect(blob).toMatch(/3d old/);
  });

  it("wallet fetch error renders ':warning: error' not '$NaN'", () => {
    const card = renderShippingTodayCard({
      summary: summary({
        wallet: [
          {
            carrierCode: "stamps_com",
            balanceUsd: null,
            fetchError: "500",
          },
        ],
        posture: "yellow",
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/error/);
    expect(blob).not.toContain("NaN");
  });

  it("read-only context note + dashboard URL present", () => {
    const card = renderShippingTodayCard({ summary: summary() });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/no label is bought from this card/i);
    expect(blob).toContain("/ops/shipping");
  });

  it("degraded list surfaces in context", () => {
    const card = renderShippingTodayCard({
      summary: summary({ degraded: ["wallet:500"] }),
    });
    expect(JSON.stringify(card.blocks)).toContain("wallet:500");
  });
});
