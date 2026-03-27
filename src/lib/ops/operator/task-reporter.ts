import { notify } from "@/lib/ops/notify";
import { readState, writeState } from "@/lib/ops/state";
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
      processed?: number;
      actionsTaken?: number;
      needsAttention?: number;
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
    poCapture?: {
      detected: number;
    };
    openPo?: {
      openCount: number;
      committedRevenue: number;
      overdueCount: number;
    };
    reports?: {
      weeklyArAp?: { ran: boolean };
      monthlyPnl?: { ran: boolean };
      monthlyBalanceSheet?: { ran: boolean };
      investorUpdate?: { ran: boolean };
    };
  };
  execution: OperatorExecutionSummary;
};

type ApprovalTask = {
  id: string;
  title: string;
  task_type: string;
};

type OperatorReportDedupState = {
  signature: string | null;
  posted_at: string | null;
};

const OPERATOR_REPORT_DEDUP_KEY = "operator:report_cycle_dedup" as const;
const OPERATOR_REPORT_DEDUP_WINDOW_MS = 60 * 60 * 1000;

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
    vendor_response_needed: "vendor reply draft",
    vendor_followup: "vendor follow-up draft",
    distributor_followup: "distributor follow-up draft",
    generate_wholesale_invoice: "wholesale invoice draft",
    generate_investor_update: "investor update package",
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

function buildReportSignature(
  summary: OperatorCycleSummary,
  approvalTasks: ApprovalTask[],
  qboHealthPct: number,
  completedLines: string[],
): string {
  const executionResults = summary.execution.results
    .filter((result) => result.status !== "completed")
    .slice(0, 5)
    .map((result) => `${result.status}:${result.taskType}:${result.message}`);

  return JSON.stringify({
    createdTasks: summary.createdTasks,
    pendingTasks: summary.pendingTasks,
    detectorSummary: summary.detectorSummary,
    execution: {
      completed: summary.execution.completed,
      failed: summary.execution.failed,
      blocked: summary.execution.blocked,
      needsApproval: summary.execution.needsApproval,
      results: executionResults,
    },
    approvalTasks: approvalTasks.map((task) => `${task.id}:${task.task_type}:${task.title}`),
    qboHealthPct,
    completedLines,
  });
}

async function shouldPostOperatorReport(signature: string): Promise<boolean> {
  const state = await readState<OperatorReportDedupState>(OPERATOR_REPORT_DEDUP_KEY, {
    signature: null,
    posted_at: null,
  });

  if (!state.signature || !state.posted_at) {
    return true;
  }

  const postedAt = new Date(state.posted_at).getTime();
  if (!Number.isFinite(postedAt)) {
    return true;
  }

  return !(state.signature === signature && Date.now() - postedAt < OPERATOR_REPORT_DEDUP_WINDOW_MS);
}

async function markOperatorReportPosted(signature: string): Promise<void> {
  await writeState(OPERATOR_REPORT_DEDUP_KEY, {
    signature,
    posted_at: new Date().toISOString(),
  } satisfies OperatorReportDedupState);
}

export async function reportOperatorCycle(summary: OperatorCycleSummary): Promise<void> {
  void summary;
}
