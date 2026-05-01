import { describe, expect, it } from "vitest";

import {
  B2B_REVENUE_WATCHER_CONTRACT,
  buildB2BRevenueWatcherRun,
  selectTopStaleBuyerActions,
  summarizeB2BRevenueWatcherInput,
} from "../b2b-revenue-watcher";
import { sourceError, sourceWired } from "../sales-command-center";
import type { StaleBuyerSummary } from "@/lib/sales/stale-buyer";

const NOW = new Date("2026-04-30T12:00:00.000Z");

function staleSummary(count: number): StaleBuyerSummary {
  return {
    asOf: NOW.toISOString(),
    stalest: Array.from({ length: count }, (_, index) => ({
      dealId: `deal-${index + 1}`,
      dealName: `Retailer ${index + 1}`,
      stageName: index === 0 ? "Contacted" : "Sample Shipped",
      daysSinceActivity: 18 - index,
      thresholdDays: index === 0 ? 5 : 10,
      isStale: true,
      nextAction:
        index === 0
          ? "Resend with a different angle"
          : "Sample-followup email",
      primaryContactId: `contact-${index + 1}`,
      primaryCompanyName: `Company ${index + 1}`,
    })),
    staleByStage: count
      ? [{ stageName: "Contacted", count, thresholdDays: 5 }]
      : [],
    activeDealsScanned: 10,
    source: { system: "hubspot", retrievedAt: NOW.toISOString() },
  };
}

function quietSources() {
  return {
    staleBuyers: sourceWired(staleSummary(0)),
    faireFollowUps: sourceWired({ overdue: 0, dueSoon: 0 }),
    pendingApprovals: sourceWired({ total: 0 }),
    wholesaleInquiries: sourceWired({ total: 2 }),
  };
}

describe("B2B Revenue Watcher", () => {
  it("contract is read-only and approval-gated", () => {
    expect(B2B_REVENUE_WATCHER_CONTRACT.agentId).toBe("b2b-revenue-watcher");
    expect(B2B_REVENUE_WATCHER_CONTRACT.cadence).toEqual({
      type: "cron",
      rrule:
        "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=45;BYSECOND=0",
    });
    expect(B2B_REVENUE_WATCHER_CONTRACT.allowedApprovalSlugs).toContain(
      "gmail.send",
    );
    expect(B2B_REVENUE_WATCHER_CONTRACT.prohibitedActions).toContain(
      "gmail.send.direct",
    );
  });

  it("quiet wired sources produce no_action", () => {
    const summary = summarizeB2BRevenueWatcherInput(quietSources());
    expect(summary.outputState).toBe("no_action");
    expect(summary.recommendedHumanAction).toBeNull();
    expect(summary.topStaleBuyers).toEqual([]);
    expect(summary.wholesaleInquiries).toBe(2);
  });

  it("actionable sources produce task_created without requesting approval", () => {
    const result = buildB2BRevenueWatcherRun({
      now: NOW,
      runId: "run-1",
      sources: {
        ...quietSources(),
        staleBuyers: sourceWired(staleSummary(3)),
        faireFollowUps: sourceWired({ overdue: 1, dueSoon: 2 }),
      },
    });
    expect(result.runRecord.outputState).toBe("task_created");
    expect(result.runRecord.approvalSlugsRequested).toEqual([]);
    expect(result.runRecord.nextHumanAction).toContain("/ops/sales");
    expect(result.runRecord.nextHumanAction).toContain("Retailer 1");
    expect(result.runRecord.summary).toContain("Top stale buyer: Retailer 1");
    expect(result.summary.staleBuyers).toBe(3);
    expect(result.summary.topStaleBuyers).toHaveLength(3);
    expect(result.summary.topStaleBuyers[0]).toMatchObject({
      dealId: "deal-1",
      dealName: "Retailer 1",
      stageName: "Contacted",
      daysSinceActivity: 18,
      nextAction: "Resend with a different angle",
    });
    expect(result.summary.faireFollowUpsDue).toBe(3);
  });

  it("degraded source produces failed_degraded and records the reason", () => {
    const result = buildB2BRevenueWatcherRun({
      now: NOW,
      runId: "run-2",
      sources: {
        ...quietSources(),
        staleBuyers: sourceError("HubSpot rate limited"),
      },
    });
    expect(result.runRecord.outputState).toBe("failed_degraded");
    expect(result.runRecord.degradedSources).toEqual([
      "staleBuyers: HubSpot rate limited",
    ]);
    expect(result.runRecord.summary).toContain("degraded");
  });

  it("selectTopStaleBuyerActions caps previews and drops non-stale rows", () => {
    const summary = staleSummary(5);
    summary.stalest[1] = { ...summary.stalest[1], isStale: false };
    const actions = selectTopStaleBuyerActions(summary, 2);
    expect(actions.map((action) => action.dealName)).toEqual([
      "Retailer 1",
      "Retailer 3",
    ]);
  });

  it("normalizes missing activity timestamps without leaking Infinity", () => {
    const summary = staleSummary(1);
    summary.stalest[0] = {
      ...summary.stalest[0],
      daysSinceActivity: Number.POSITIVE_INFINITY,
    };
    const result = summarizeB2BRevenueWatcherInput({
      ...quietSources(),
      staleBuyers: sourceWired(summary),
    });
    expect(result.topStaleBuyers[0].daysSinceActivity).toBeNull();
    expect(result.recommendedHumanAction).toContain("no activity timestamp");
  });
});
