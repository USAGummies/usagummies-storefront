import { notify } from "@/lib/ops/notify";
import type { OperatorExecutionSummary } from "@/lib/ops/operator/task-executor";

export type OperatorCycleSummary = {
  createdTasks: number;
  pendingTasks: number;
  detectorSummary: {
    qbo: {
      uncategorized: number;
      missingVendors: number;
      zeroRevenueAccounts: number;
      unrecordedKnownTransactions: number;
    };
    email: {
      replyTasks: number;
      qboEmailTasks: number;
    };
    pipeline: {
      distributorFollowups: number;
      vendorFollowups: number;
    };
  };
  execution: OperatorExecutionSummary;
};

function formatExecutionLines(summary: OperatorExecutionSummary): string[] {
  return summary.results.slice(0, 8).map((result) => {
    const icon =
      result.status === "completed" ? "✅" :
      result.status === "needs_approval" ? "⏳" :
      result.status === "blocked" ? "⛔" :
      "⚠️";
    return `${icon} ${result.message}`;
  });
}

export async function reportOperatorCycle(summary: OperatorCycleSummary): Promise<void> {
  const hasMaterialActivity =
    summary.createdTasks > 0 ||
    summary.execution.completed > 0 ||
    summary.execution.failed > 0 ||
    summary.execution.blocked > 0 ||
    summary.execution.needsApproval > 0;

  if (!hasMaterialActivity) return;

  const text = [
    `🤖 *Abra Operator Cycle* — ${new Date().toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" })} PT`,
    "",
    `*QBO:* ${summary.detectorSummary.qbo.uncategorized} uncategorized, ${summary.detectorSummary.qbo.missingVendors} missing vendors, ${summary.detectorSummary.qbo.zeroRevenueAccounts} zero-balance revenue accounts, ${summary.detectorSummary.qbo.unrecordedKnownTransactions} known transactions not yet in QBO`,
    `*Email:* ${summary.detectorSummary.email.replyTasks} reply draft task(s), ${summary.detectorSummary.email.qboEmailTasks} QBO-from-email task(s)`,
    `*Pipeline:* ${summary.detectorSummary.pipeline.distributorFollowups} distributor follow-up(s), ${summary.detectorSummary.pipeline.vendorFollowups} vendor follow-up(s)`,
    `*Queued:* ${summary.createdTasks} new operator task(s)`,
    `*Executed:* ${summary.execution.completed} completed, ${summary.execution.failed} failed, ${summary.execution.blocked} blocked, ${summary.execution.needsApproval} awaiting approval`,
    ...(summary.pendingTasks > 0 ? [`*Remaining Pending:* ${summary.pendingTasks}`] : []),
    "",
    ...formatExecutionLines(summary.execution),
  ]
    .filter(Boolean)
    .join("\n");

  await notify({
    channel: "alerts",
    text,
  });
}
