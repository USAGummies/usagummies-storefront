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
      categorizedTransactions: number;
      totalTransactions: number;
    };
    email: {
      replyTasks: number;
      qboEmailTasks: number;
    };
    pipeline: {
      distributorFollowups: number;
      vendorFollowups: number;
    };
    vendorPayments?: {
      dueSoonCount: number;
      dueSoonAmount: number;
      overdueCount: number;
      overdueAmount: number;
    };
    inventory?: {
      healthy: number;
      info: number;
      warning: number;
      critical: number;
    };
    reconciliation?: {
      ran: boolean;
      discrepancies: number;
      amazonDifference: number;
      shopifyDifference: number;
      bankDifference: number;
    };
    wholesale?: {
      invoiceTasks: number;
    };
  };
  execution: OperatorExecutionSummary;
};

type ApprovalTask = {
  id: string;
  title: string;
  task_type: string;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(10000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status})`);
  return json as T;
}

function summarizeCompletedTasks(summary: OperatorExecutionSummary): string[] {
  const counts = new Map<string, number>();
  for (const result of summary.results) {
    if (result.status !== "completed") continue;
    counts.set(result.taskType, (counts.get(result.taskType) || 0) + 1);
  }
  const label: Record<string, string> = {
    qbo_categorize: "QBO categorization",
    qbo_assign_vendor: "vendor assignment",
    qbo_record_transaction: "QBO journal record",
    qbo_record_from_email: "QBO email import",
    qbo_revenue_gap: "QBO revenue sync",
    email_draft_response: "email draft",
    vendor_followup: "vendor follow-up draft",
    distributor_followup: "distributor follow-up draft",
    generate_wholesale_invoice: "wholesale invoice draft",
    inventory_reorder_po: "inventory PO draft",
  };

  return Array.from(counts.entries()).map(([taskType, count]) =>
    `✅ ${count} ${label[taskType] || taskType}${count === 1 ? "" : "s"}`
  );
}

async function fetchApprovalTasks(limit = 3): Promise<ApprovalTask[]> {
  return sbFetch<ApprovalTask[]>(
    `/rest/v1/abra_operator_tasks?select=id,title,task_type&status=eq.needs_approval&order=created_at.asc&limit=${limit}`,
  ).catch(() => []);
}

function buildApprovalBlocks(tasks: ApprovalTask[]): unknown[] {
  const blocks: unknown[] = [];
  for (const task of tasks) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `⏳ *Needs approval* — ${task.title}` },
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve" },
          style: "primary",
          action_id: "approve_operator_task",
          value: task.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          action_id: "reject_operator_task",
          value: task.id,
        },
      ],
    });
  }
  return blocks;
}

export async function reportOperatorCycle(summary: OperatorCycleSummary): Promise<void> {
  const hasMaterialActivity =
    summary.createdTasks > 0 ||
    summary.execution.completed > 0 ||
    summary.execution.failed > 0 ||
    summary.execution.blocked > 0 ||
    summary.execution.needsApproval > 0;

  if (!hasMaterialActivity) return;

  const approvalTasks = await fetchApprovalTasks();
  const qboHealthPct = summary.detectorSummary.qbo.totalTransactions > 0
    ? Math.round((summary.detectorSummary.qbo.categorizedTransactions / summary.detectorSummary.qbo.totalTransactions) * 100)
    : 100;

  const completedLines = summarizeCompletedTasks(summary.execution);

  const lines = [
    `🤖 *Abra Operator Cycle* — ${new Date().toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" })} PT`,
    "",
    `*QBO:* ${summary.detectorSummary.qbo.uncategorized} uncategorized, ${summary.detectorSummary.qbo.missingVendors} missing vendors, ${summary.detectorSummary.qbo.zeroRevenueAccounts} zero-balance revenue accounts, ${summary.detectorSummary.qbo.unrecordedKnownTransactions} known transactions not yet in QBO`,
    `*QBO Health:* ${qboHealthPct}% categorized (${summary.detectorSummary.qbo.categorizedTransactions}/${summary.detectorSummary.qbo.totalTransactions})`,
    `*Email:* ${summary.detectorSummary.email.replyTasks} reply draft task(s), ${summary.detectorSummary.email.qboEmailTasks} QBO-from-email task(s)`,
    `*Pipeline:* ${summary.detectorSummary.pipeline.distributorFollowups} distributor follow-up(s), ${summary.detectorSummary.pipeline.vendorFollowups} vendor follow-up(s)`,
    ...(summary.detectorSummary.vendorPayments
      ? [
          `*AP:* ${summary.detectorSummary.vendorPayments.dueSoonCount} due soon (${summary.detectorSummary.vendorPayments.dueSoonAmount.toFixed(2)}), ` +
            `${summary.detectorSummary.vendorPayments.overdueCount} overdue (${summary.detectorSummary.vendorPayments.overdueAmount.toFixed(2)})`,
        ]
      : []),
    ...(summary.detectorSummary.inventory
      ? [
          `*Inventory:* ${summary.detectorSummary.inventory.critical} critical, ${summary.detectorSummary.inventory.warning} warning, ${summary.detectorSummary.inventory.info} info`,
        ]
      : []),
    ...(summary.detectorSummary.reconciliation?.ran
      ? [
          `*Reconciliation:* ${summary.detectorSummary.reconciliation.discrepancies} discrepancy task(s) ` +
            `(Amazon ${summary.detectorSummary.reconciliation.amazonDifference.toFixed(2)}, Shopify ${summary.detectorSummary.reconciliation.shopifyDifference.toFixed(2)}, Bank ${summary.detectorSummary.reconciliation.bankDifference.toFixed(2)})`,
        ]
      : []),
    ...(summary.detectorSummary.wholesale
      ? [`*Wholesale:* ${summary.detectorSummary.wholesale.invoiceTasks} invoice draft task(s)`]
      : []),
    `*Queued:* ${summary.createdTasks} new operator task(s)`,
    `*Executed:* ${summary.execution.completed} completed, ${summary.execution.failed} failed, ${summary.execution.blocked} blocked, ${summary.execution.needsApproval} awaiting approval`,
    ...(summary.pendingTasks > 0 ? [`*Remaining Pending:* ${summary.pendingTasks}`] : []),
    ...(approvalTasks.length ? [`*Needs Approval:* ${approvalTasks.length}`] : []),
    "",
    ...completedLines,
    ...summary.execution.results
      .filter((result) => result.status !== "completed")
      .slice(0, 5)
      .map((result) => {
        const icon = result.status === "blocked" ? "⛔" : result.status === "needs_approval" ? "⏳" : "⚠️";
        return `${icon} ${result.message}`;
      }),
  ].filter(Boolean);

  let text = lines.join("\n");
  if (text.length > 2000) {
    text = `${text.slice(0, 1997)}...`;
  }

  await notify({
    channel: "alerts",
    text,
    blocks: approvalTasks.length ? buildApprovalBlocks(approvalTasks) : undefined,
  });
}
