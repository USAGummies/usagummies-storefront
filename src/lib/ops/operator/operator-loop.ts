import { detectEmailOperatorGaps } from "@/lib/ops/operator/gap-detectors/email";
import { detectInventoryAlerts } from "@/lib/ops/operator/gap-detectors/inventory";
import { detectPipelineOperatorGaps } from "@/lib/ops/operator/gap-detectors/pipeline";
import { detectQBOOperatorGaps } from "@/lib/ops/operator/gap-detectors/qbo";
import { detectVendorPaymentTasks } from "@/lib/ops/operator/gap-detectors/vendor-payments";
import { runOperatorHealthMonitor } from "@/lib/ops/operator/health-monitor";
import { runPnlSanityChecker } from "@/lib/ops/operator/pnl-sanity-checker";
import { runDailyFinancialReconciliation } from "@/lib/ops/operator/reconciliation";
import { runInvestorUpdatePackage } from "@/lib/ops/operator/reports/investor-update";
import { runMonthlyBalanceSheetReport } from "@/lib/ops/operator/reports/monthly-balance-sheet";
import { runMonthlyPnlReport } from "@/lib/ops/operator/reports/monthly-pnl";
import { runWeeklyArApReport } from "@/lib/ops/operator/reports/weekly-ar-ap";
import { createOperatorTasks, executeOperatorTasks } from "@/lib/ops/operator/task-executor";
import { reportOperatorCycle } from "@/lib/ops/operator/task-reporter";

export type OperatorLoopResult = {
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
    vendorPayments: {
      dueSoonCount: number;
      dueSoonAmount: number;
      overdueCount: number;
      overdueAmount: number;
    };
    inventory: {
      healthy: number;
      info: number;
      warning: number;
      critical: number;
    };
    reconciliation: {
      ran: boolean;
      discrepancies: number;
      amazonDifference: number;
      shopifyDifference: number;
      bankDifference: number;
    };
    wholesale: {
      invoiceTasks: number;
    };
    reports?: {
      weeklyArAp?: { ran: boolean };
      monthlyPnl?: { ran: boolean };
      monthlyBalanceSheet?: { ran: boolean };
      investorUpdate?: { ran: boolean };
    };
  };
  execution: {
    scanned: number;
    completed: number;
    failed: number;
    blocked: number;
    needsApproval: number;
    results: Array<{
      taskId: string;
      taskType: string;
      status: "pending" | "in_progress" | "completed" | "failed" | "blocked" | "needs_approval";
      message: string;
    }>;
  };
  health?: {
    ok: boolean;
    checks: Array<{
      name: "qbo" | "slack" | "gmail" | "supabase" | "brain";
      ok: boolean;
      detail: string;
    }>;
  };
  pnlSanity?: {
    ok: boolean;
    corrections: string[];
    revenue: number;
    cogs: number;
    expenses: number;
    netIncome: number;
  };
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(20000),
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return json as T;
}

async function getPendingCount(): Promise<number> {
  const rows = await sbFetch<Array<{ id: string }>>(
    "/rest/v1/abra_operator_tasks?status=in.(pending,needs_approval,in_progress)&select=id",
  ).catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

type WholesaleBrainRow = {
  id: string;
  title: string;
  raw_text?: string | null;
  summary_text?: string | null;
  created_at: string;
  source_ref?: string | null;
  category?: string | null;
  source_type?: string | null;
};

function buildNaturalKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function extractQuantity(text: string): number | null {
  const patterns = [
    /(\d[\d,]*)\s+units?\b/i,
    /qty(?:uantity)?[:\s]+(\d[\d,]*)/i,
    /ship(?:ped|ment)?[:\s]+(\d[\d,]*)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

async function detectWholesaleInvoiceTasks() {
  const existingTasks = await sbFetch<Array<{
    execution_params?: Record<string, unknown> | null;
    status?: string | null;
    created_at?: string | null;
    completed_at?: string | null;
  }>>(
    `/rest/v1/abra_operator_tasks?source=eq.gap_detector:wholesale&select=execution_params,status,created_at,completed_at&created_at=gte.${encodeURIComponent(
      new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    )}&limit=200`,
  ).catch(() => []);

  const seenNaturalKeys = new Set(
    (Array.isArray(existingTasks) ? existingTasks : [])
      .map((row) => String(row.execution_params?.natural_key || "").trim().toLowerCase())
      .filter(Boolean),
  );

  const rows = await sbFetch<WholesaleBrainRow[]>(
    `/rest/v1/open_brain_entries?select=id,title,raw_text,summary_text,created_at,source_ref,category,source_type&created_at=gte.${encodeURIComponent(
      new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
    )}&or=(category.eq.teaching,source_type.eq.manual,title.ilike.*inderbitzin*,raw_text.ilike.*inderbitzin*,raw_text.ilike.*wholesale*,raw_text.ilike.*shipment*)&order=created_at.desc&limit=100`,
  ).catch(() => []);

  const tasks = (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const text = `${row.title}\n${row.raw_text || row.summary_text || ""}`;
    const sourceType = String(row.source_type || "").toLowerCase();
    const category = String(row.category || "").toLowerCase();
    const sourceRef = String(row.source_ref || "");
    const isTeaching = (category === "teaching" || sourceType === "manual") &&
      (/^teaching:/i.test(row.title) || /^taught by/i.test(String(row.raw_text || ""))) &&
      !/^(morning-brief-|conversation-thread:)/i.test(sourceRef);
    if (!isTeaching) return [];
    if (!/(inderbitzin|wholesale|customer:)/i.test(text)) return [];
    if (!/\b(ship|shipped|shipment|delivered)\b/i.test(text)) return [];

    const quantity = extractQuantity(text);
    if (!quantity) return [];

    const explicitCustomer = text.match(/customer:\s*([^\n]+)/i)?.[1]?.trim() || "";
    const customerName =
      /inderbitzin/i.test(text)
        ? "Inderbitzin"
        : explicitCustomer;
    if (!customerName) return [];

    const naturalKey = buildNaturalKey(["generate_wholesale_invoice", row.id, quantity]);
    if (seenNaturalKeys.has(naturalKey)) return [];

    return [{
      task_type: "generate_wholesale_invoice",
      title: `Create draft wholesale invoice for ${customerName} — ${quantity} units`,
      description: `Detected shipped wholesale order for ${customerName} from brain entry "${row.title}".`,
      priority: "high" as const,
      source: "gap_detector:wholesale",
      assigned_to: "abra",
      requires_approval: true,
      execution_params: {
        natural_key: naturalKey,
        source_ref: row.source_ref || row.id,
        customer_name: customerName,
        customer_id: "20",
        quantity,
        units: quantity,
        ship_date: String(row.created_at || "").slice(0, 10),
      },
      tags: ["finance", "invoice", "wholesale"],
    }];
  });

  return {
    tasks,
    summary: {
      invoiceTasks: tasks.length,
    },
  };
}

export async function runOperatorLoop(): Promise<OperatorLoopResult> {
  const [qbo, email, pipeline, vendorPayments, inventory, reconciliation, wholesale] = await Promise.all([
    detectQBOOperatorGaps(),
    detectEmailOperatorGaps(),
    detectPipelineOperatorGaps(),
    detectVendorPaymentTasks(),
    detectInventoryAlerts(),
    runDailyFinancialReconciliation(),
    detectWholesaleInvoiceTasks(),
  ]);
  const createdTasks = await createOperatorTasks([
    ...qbo.tasks,
    ...email.tasks,
    ...pipeline.tasks,
    ...vendorPayments.tasks,
    ...inventory.tasks,
    ...reconciliation.tasks,
    ...wholesale.tasks,
  ]);
  const execution = await executeOperatorTasks(12);
  const pendingTasks = await getPendingCount();
  const qboModified = execution.results.some(
    (row) =>
      row.status === "completed" &&
      (
        row.taskType === "qbo_categorize" ||
        row.taskType === "qbo_assign_vendor" ||
        row.taskType === "qbo_record_transaction" ||
        row.taskType === "qbo_record_from_email" ||
        row.taskType === "qbo_revenue_gap" ||
        row.taskType === "generate_wholesale_invoice"
      ),
  );

  const result: OperatorLoopResult = {
    createdTasks,
    pendingTasks,
    detectorSummary: {
      qbo: qbo.summary,
      email: email.summary,
      pipeline: pipeline.summary,
      vendorPayments: vendorPayments.summary,
      inventory: inventory.summary,
      reconciliation: {
        ran: reconciliation.summary.ran,
        discrepancies: reconciliation.summary.discrepancies,
        amazonDifference: reconciliation.summary.amazonDifference,
        shopifyDifference: reconciliation.summary.shopifyDifference,
        bankDifference: reconciliation.summary.bankDifference,
      },
      wholesale: wholesale.summary,
    },
    execution,
  };

  if (qboModified) {
    result.pnlSanity = await runPnlSanityChecker();
  }

  const [weeklyArAp, monthlyPnl, monthlyBalanceSheet, investorUpdate] = await Promise.all([
    runWeeklyArApReport().catch(() => ({ ran: false })),
    runMonthlyPnlReport().catch(() => ({ ran: false })),
    runMonthlyBalanceSheetReport().catch(() => ({ ran: false })),
    runInvestorUpdatePackage().catch(() => ({ ran: false })),
  ]);
  result.detectorSummary.reports = {
    weeklyArAp: { ran: Boolean(weeklyArAp.ran) },
    monthlyPnl: { ran: Boolean(monthlyPnl.ran) },
    monthlyBalanceSheet: { ran: Boolean(monthlyBalanceSheet.ran) },
    investorUpdate: { ran: Boolean(investorUpdate.ran) },
  };

  await reportOperatorCycle(result);
  result.health = await runOperatorHealthMonitor();
  return result;
}
