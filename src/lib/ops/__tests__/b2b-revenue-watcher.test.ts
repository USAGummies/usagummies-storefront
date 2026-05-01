import { describe, expect, it } from "vitest";

import {
  B2B_REVENUE_WATCHER_CONTRACT,
  buildB2BRevenueWatcherRun,
  summarizeB2BRevenueWatcherInput,
} from "../b2b-revenue-watcher";
import { sourceError, sourceWired } from "../sales-command-center";
import type { StaleBuyerSummary } from "@/lib/sales/stale-buyer";

const NOW = new Date("2026-04-30T12:00:00.000Z");

function staleSummary(count: number): StaleBuyerSummary {
  return {
    asOf: NOW.toISOString(),
    stalest: [],
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
    expect(result.summary.staleBuyers).toBe(3);
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
});
