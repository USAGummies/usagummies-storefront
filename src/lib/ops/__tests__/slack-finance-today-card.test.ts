/**
 * Slack `finance today` card renderer coverage.
 *
 * Pins:
 *   - Empty queue → clean copy, no top-packets section.
 *   - Posture chip (🟢/🟡/🔴) renders in header + text.
 *   - Pending counts surface in fields block.
 *   - Stale (red) posture surfaces "STALE" copy in brief.
 *   - Top packets render with vendor / amount / status / warnings.
 *   - Dashboard buttons present + canonical /ops paths.
 *   - Degraded list surfaces in context block.
 */
import { describe, expect, it } from "vitest";

import { renderFinanceTodayCard } from "../slack-finance-today-card";
import type {
  FinancePacketRow,
  FinanceTodaySummary,
} from "../finance-today";

function summary(
  overrides: Partial<FinanceTodaySummary> = {},
): FinanceTodaySummary {
  return {
    pendingPromote: 0,
    pendingFinanceApprovals: 0,
    draftPackets: 0,
    reneApprovedPackets: 0,
    rejectedPackets: 0,
    draftEligiblePackets: 0,
    oldestPendingApprovals: [],
    topPackets: [],
    posture: "green",
    degraded: [],
    ...overrides,
  };
}

function packet(
  overrides: Partial<FinancePacketRow> = {},
): FinancePacketRow {
  return {
    packetId: "pkt-v1-rcpt-1",
    receiptId: "rcpt-1",
    vendor: "Albanese",
    amount: 100,
    status: "draft",
    eligibilityOk: true,
    warnings: 0,
    createdAt: "2026-05-02T17:00:00.000Z",
    ...overrides,
  };
}

describe("renderFinanceTodayCard", () => {
  it("empty + green renders clean copy", () => {
    const card = renderFinanceTodayCard({ summary: summary() });
    expect(card.text).toMatch(/clean/);
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/Clean queue/);
    expect(blob).toMatch(/🟢/);
  });

  it("yellow posture surfaces work-waiting label", () => {
    const card = renderFinanceTodayCard({
      summary: summary({
        posture: "yellow",
        pendingFinanceApprovals: 2,
        pendingPromote: 2,
      }),
    });
    expect(card.text).toMatch(/🟡/);
  });

  it("red posture renders STALE warning in brief", () => {
    const card = renderFinanceTodayCard({
      summary: summary({
        posture: "red",
        pendingFinanceApprovals: 1,
        pendingPromote: 1,
        oldestPendingApprovals: [
          {
            id: "a-stale",
            actorAgentId: "ops",
            action: "Receipt promote",
            createdAt: "2026-04-28T18:00:00.000Z",
            ageDays: 4,
          },
        ],
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/Stale approval/i);
    expect(blob).toMatch(/🔴/);
  });

  it("renders pending counts in fields block", () => {
    const card = renderFinanceTodayCard({
      summary: summary({
        pendingFinanceApprovals: 7,
        pendingPromote: 5,
        draftEligiblePackets: 3,
        reneApprovedPackets: 2,
        rejectedPackets: 1,
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("Pending approvals");
    expect(blob).toContain("\\n7");
    expect(blob).toContain("Receipt promote");
    expect(blob).toContain("\\n5");
    expect(blob).toContain("Draft + eligible");
    expect(blob).toContain("\\n3");
    expect(blob).toContain("Rene-approved");
    expect(blob).toContain("\\n2");
    expect(blob).toContain("Rejected");
    expect(blob).toContain("\\n1");
  });

  it("top packets section lists vendor / amount / status / warnings", () => {
    const card = renderFinanceTodayCard({
      summary: summary({
        topPackets: [
          packet({
            packetId: "pkt-v1-a",
            vendor: "Albanese",
            amount: 12345.67,
            status: "draft",
            warnings: 0,
          }),
          packet({
            packetId: "pkt-v1-b",
            vendor: "Belmark",
            amount: 999,
            status: "rene-approved",
            warnings: 0,
          }),
          packet({
            packetId: "pkt-v1-c",
            vendor: null,
            amount: null,
            status: "draft",
            warnings: 2,
          }),
        ],
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("Albanese");
    expect(blob).toContain("$12345.67");
    expect(blob).toContain("Belmark");
    expect(blob).toContain("rene-approved");
    expect(blob).toContain("(no vendor)");
    expect(blob).toContain("(no amount)");
    expect(blob).toContain("⚠️2");
  });

  it("dashboard buttons present + canonical /ops paths", () => {
    const card = renderFinanceTodayCard({ summary: summary() });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("/ops/finance/review");
    expect(blob).toContain("/ops/finance/review-packets");
    expect(blob).toContain("Open review queue");
    expect(blob).toContain("Open review packets");
  });

  it("degraded list surfaces in context block", () => {
    const card = renderFinanceTodayCard({
      summary: summary({
        degraded: ["approval-store: timeout", "kv-get: dropped"],
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("Degraded");
    expect(blob).toContain("approval-store: timeout");
    expect(blob).toContain("kv-get: dropped");
  });

  it("never references QBO writes — read-only context note present", () => {
    const card = renderFinanceTodayCard({ summary: summary() });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/no QBO write fires from this card/i);
  });
});
