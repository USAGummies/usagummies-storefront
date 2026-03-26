import { readFile } from "node:fs/promises";
import path from "node:path";
import { ensureEntityStatesInitialized } from "@/lib/ops/operator/entities/entity-state";
import { runBatchTransactionReview } from "@/lib/ops/operator/batch-review";
import { detectEmailOperatorGaps } from "@/lib/ops/operator/gap-detectors/email";
import { detectInventoryAlerts } from "@/lib/ops/operator/gap-detectors/inventory";
import { detectPipelineOperatorGaps } from "@/lib/ops/operator/gap-detectors/pipeline";
import { detectPoCaptureTasks } from "@/lib/ops/operator/gap-detectors/po-capture";
import { detectQBOOperatorGaps, upgradeExistingQboReviewTasks } from "@/lib/ops/operator/gap-detectors/qbo";
import { detectVendorPaymentTasks } from "@/lib/ops/operator/gap-detectors/vendor-payments";
import { runOperatorHealthMonitor } from "@/lib/ops/operator/health-monitor";
import { runMeetingPrepAutoGeneration } from "@/lib/ops/operator/meeting-prep";
import { runOpenPoTracker } from "@/lib/ops/operator/po-tracker";
import { runPnlSanityChecker } from "@/lib/ops/operator/pnl-sanity-checker";
import { surfaceProactiveEmailTasks } from "@/lib/ops/operator/proactive-email";
import { runDailyFinancialReconciliation } from "@/lib/ops/operator/reconciliation";
import { runInvestorUpdatePackage } from "@/lib/ops/operator/reports/investor-update";
import { runMonthlyBalanceSheetReport } from "@/lib/ops/operator/reports/monthly-balance-sheet";
import { runMonthlyPnlReport } from "@/lib/ops/operator/reports/monthly-pnl";
import { runWeeklyArApReport } from "@/lib/ops/operator/reports/weekly-ar-ap";
import { createOperatorTasks, executeOperatorTasks } from "@/lib/ops/operator/task-executor";
import { reportOperatorCycle } from "@/lib/ops/operator/task-reporter";
import { runUnifiedInventoryPosition } from "@/lib/ops/operator/unified-inventory";
import { runUnifiedRevenueDashboard } from "@/lib/ops/operator/unified-revenue";
import { readState, writeState } from "@/lib/ops/state";

export interface StepLastRun {
  timestamp: string;
  result: "success" | "partial" | "failed";
  items_processed: number;
  items_changed: number;
  next_check_after: string;
  notes: string;
}

const STEP_STATE_KEYS = {
  qbo_gap: "operator:step:qbo_gap:last_run" as const,
  email_gap: "operator:step:email_gap:last_run" as const,
  pipeline_gap: "operator:step:pipeline_gap:last_run" as const,
  vendor_payments: "operator:step:vendor_payments:last_run" as const,
  inventory: "operator:step:inventory:last_run" as const,
  reconciliation: "operator:step:reconciliation:last_run" as const,
  wholesale: "operator:step:wholesale:last_run" as const,
  po_capture: "operator:step:po_capture:last_run" as const,
  task_execution: "operator:step:task_execution:last_run" as const,
  unified_revenue: "operator:step:unified_revenue:last_run" as const,
  unified_inventory: "operator:step:unified_inventory:last_run" as const,
  open_po_tracker: "operator:step:open_po_tracker:last_run" as const,
  email_surface: "operator:step:email_surface:last_run" as const,
  batch_review: "operator:step:batch_review:last_run" as const,
  meeting_prep: "operator:step:meeting_prep:last_run" as const,
  health_monitor: "operator:step:health_monitor:last_run" as const,
};

type StepOutcome<T> = {
  data: T;
  state: StepLastRun & { skipped?: boolean };
};

async function loadOperatorGuidance(): Promise<{
  heartbeatLoaded: boolean;
  soulLoaded: boolean;
  heartbeatItems: string[];
}> {
  const root = process.cwd();
  const [heartbeatText, soulText] = await Promise.all([
    readFile(path.join(root, "HEARTBEAT.md"), "utf8").catch(() => ""),
    readFile(path.join(root, "SOUL.md"), "utf8").catch(() => ""),
  ]);
  const heartbeatItems = heartbeatText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- [ ] "))
    .map((line) => line.replace(/^- \[ \]\s*/, "").trim());
  return {
    heartbeatLoaded: Boolean(heartbeatText.trim()),
    soulLoaded: Boolean(soulText.trim()),
    heartbeatItems,
  };
}

async function runStep<T>(
  key: keyof typeof STEP_STATE_KEYS,
  minDelayMinutes: number,
  runner: () => Promise<T>,
  summarize: (data: T) => { result?: "success" | "partial" | "failed"; itemsProcessed?: number; itemsChanged?: number; notes?: string },
): Promise<StepOutcome<T | null>> {
  const prior = await readState<StepLastRun | null>(STEP_STATE_KEYS[key], null);
  if (prior?.next_check_after && Date.now() < new Date(prior.next_check_after).getTime()) {
    return { data: null, state: { ...prior, skipped: true } };
  }

  const data = await runner();
  const summary = summarize(data);
  const state: StepLastRun = {
    timestamp: new Date().toISOString(),
    result: summary.result || "success",
    items_processed: summary.itemsProcessed || 0,
    items_changed: summary.itemsChanged || 0,
    next_check_after: new Date(Date.now() + minDelayMinutes * 60_000).toISOString(),
    notes: summary.notes || "",
  };
  await writeState(STEP_STATE_KEYS[key], state);
  return { data, state };
}

export type OperatorLoopResult = {
  createdTasks: number;
  pendingTasks: number;
  stepRuns?: Record<string, StepLastRun & { skipped?: boolean }>;
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
  await ensureEntityStatesInitialized();
  const guidance = await loadOperatorGuidance();

  const [qboStep, emailStep, pipelineStep, vendorPaymentsStep, inventoryStep, reconciliationStep, wholesaleStep, poCaptureStep] = await Promise.all([
    runStep("qbo_gap", 15, () => detectQBOOperatorGaps(), (data) => ({
      itemsProcessed: data.summary.totalTransactions,
      itemsChanged: data.summary.uncategorized,
      notes: `uncategorized=${data.summary.uncategorized}`,
    })),
    runStep("email_gap", 15, () => detectEmailOperatorGaps(), (data) => ({
      itemsProcessed: data.tasks.length,
      itemsChanged: data.summary.replyTasks + data.summary.qboEmailTasks,
      notes: `reply=${data.summary.replyTasks} qbo=${data.summary.qboEmailTasks}`,
    })),
    runStep("pipeline_gap", 30, () => detectPipelineOperatorGaps(), (data) => ({
      itemsProcessed: data.tasks.length,
      itemsChanged: data.summary.distributorFollowups + data.summary.vendorFollowups,
      notes: `distributor=${data.summary.distributorFollowups} vendor=${data.summary.vendorFollowups}`,
    })),
    runStep("vendor_payments", 60, () => detectVendorPaymentTasks(), (data) => ({
      itemsProcessed: data.tasks.length,
      itemsChanged: data.summary.dueSoonCount + data.summary.overdueCount,
      notes: `due=${data.summary.dueSoonCount} overdue=${data.summary.overdueCount}`,
    })),
    runStep("inventory", 60, () => detectInventoryAlerts(), (data) => ({
      itemsProcessed: data.tasks.length,
      itemsChanged: data.summary.warning + data.summary.critical,
      notes: `warning=${data.summary.warning} critical=${data.summary.critical}`,
    })),
    runStep("reconciliation", 24 * 60, () => runDailyFinancialReconciliation(), (data) => ({
      itemsProcessed: data.tasks.length,
      itemsChanged: data.summary.discrepancies,
      notes: `ran=${data.summary.ran} discrepancies=${data.summary.discrepancies}`,
    })),
    runStep("wholesale", 60, () => detectWholesaleInvoiceTasks(), (data) => ({
      itemsProcessed: data.tasks.length,
      itemsChanged: data.summary.invoiceTasks,
      notes: `invoiceTasks=${data.summary.invoiceTasks}`,
    })),
    runStep("po_capture", 30, () => detectPoCaptureTasks(), (data) => ({
      itemsProcessed: data.tasks.length,
      itemsChanged: data.summary.detected,
      notes: `detected=${data.summary.detected}`,
    })),
  ]);
  const qbo = qboStep.data || { tasks: [], summary: { uncategorized: 0, missingVendors: 0, zeroRevenueAccounts: 0, unrecordedKnownTransactions: 0, categorizedTransactions: 0, totalTransactions: 0 } };
  const email = emailStep.data || { tasks: [], summary: { replyTasks: 0, qboEmailTasks: 0 } };
  const pipeline = pipelineStep.data || { tasks: [], summary: { distributorFollowups: 0, vendorFollowups: 0 } };
  const vendorPayments = vendorPaymentsStep.data || { tasks: [], summary: { dueSoonCount: 0, dueSoonAmount: 0, overdueCount: 0, overdueAmount: 0 } };
  const inventory = inventoryStep.data || { tasks: [], summary: { healthy: 0, info: 0, warning: 0, critical: 0 } };
  const reconciliation = reconciliationStep.data || { tasks: [], summary: { ran: false, discrepancies: 0, amazonDifference: 0, shopifyDifference: 0, bankDifference: 0 } };
  const wholesale = wholesaleStep.data || { tasks: [], summary: { invoiceTasks: 0 } };
  const poCapture = poCaptureStep.data || { tasks: [], summary: { detected: 0 } };
  const createdTasks = await createOperatorTasks([
    ...qbo.tasks,
    ...email.tasks,
    ...pipeline.tasks,
    ...vendorPayments.tasks,
    ...inventory.tasks,
    ...reconciliation.tasks,
    ...wholesale.tasks,
    ...poCapture.tasks,
  ]);
  const upgradedReviewTasks = await upgradeExistingQboReviewTasks().catch(() => 0);
  const executionLimit = qbo.summary.uncategorized >= 20 ? 60 : 12;
  const executionStep = await runStep("task_execution", 5, () => executeOperatorTasks(executionLimit), (data) => ({
    itemsProcessed: data.scanned,
    itemsChanged: data.completed + data.needsApproval,
    notes: `completed=${data.completed} failed=${data.failed}`,
    result: data.failed > 0 ? "partial" : "success",
  }));
  const execution = executionStep.data || {
    scanned: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    needsApproval: 0,
    results: [],
  };
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
    createdTasks: createdTasks + upgradedReviewTasks,
    pendingTasks,
    stepRuns: {
      guidance: {
        timestamp: new Date().toISOString(),
        result: guidance.heartbeatLoaded && guidance.soulLoaded ? "success" : "failed",
        items_processed: guidance.heartbeatItems.length,
        items_changed: 0,
        next_check_after: new Date(Date.now() + 60_000).toISOString(),
        notes: `heartbeat=${guidance.heartbeatLoaded} soul=${guidance.soulLoaded} order=${guidance.heartbeatItems.join(" | ")}`,
      },
      qbo_gap: qboStep.state,
      email_gap: emailStep.state,
      pipeline_gap: pipelineStep.state,
      vendor_payments: vendorPaymentsStep.state,
      inventory: inventoryStep.state,
      reconciliation: reconciliationStep.state,
      wholesale: wholesaleStep.state,
      po_capture: poCaptureStep.state,
      task_execution: executionStep.state,
    },
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
      poCapture: poCapture.summary,
    },
    execution,
  };

  if (qboModified) {
    result.pnlSanity = await runPnlSanityChecker();
  }

  const [revenueStep, inventoryPositionStep, openPoStep] = await Promise.all([
    runStep("unified_revenue", 12 * 60, () => runUnifiedRevenueDashboard(), (data) => ({
      itemsProcessed: data.summary ? 1 : 0,
      itemsChanged: data.ran ? 1 : 0,
      notes: `ran=${data.ran}`,
    })),
    runStep("unified_inventory", 12 * 60, () => runUnifiedInventoryPosition(), (data) => ({
      itemsProcessed: data.summary ? 1 : 0,
      itemsChanged: data.ran ? 1 : 0,
      notes: `ran=${data.ran}`,
    })),
    runStep("open_po_tracker", 60, () => runOpenPoTracker(), (data) => ({
      itemsProcessed: data.openCount,
      itemsChanged: data.overdue.length,
      notes: `open=${data.openCount} overdue=${data.overdue.length}`,
    })),
  ]);
  const openPoSummary = openPoStep.data || { openCount: 0, committedRevenue: 0, overdue: [] };
  Object.assign(result.stepRuns || {}, {
    unified_revenue: revenueStep.state,
    unified_inventory: inventoryPositionStep.state,
    open_po_tracker: openPoStep.state,
  });
  result.detectorSummary.openPo = {
    openCount: openPoSummary.openCount,
    committedRevenue: openPoSummary.committedRevenue,
    overdueCount: openPoSummary.overdue.length,
  };

  const [emailSurfaceStep, batchReviewStep, meetingPrepStep] = await Promise.all([
    runStep("email_surface", 6 * 60, () => surfaceProactiveEmailTasks(), (data) => ({
      itemsProcessed: data.surfaced,
      itemsChanged: data.surfaced,
      notes: `surfaced=${data.surfaced}`,
    })),
    runStep("batch_review", 24 * 60, () => runBatchTransactionReview(), (data) => ({
      itemsProcessed: data.ran ? 1 : 0,
      itemsChanged: data.ran ? 1 : 0,
      notes: `ran=${data.ran}`,
    })),
    runStep("meeting_prep", 24 * 60, () => runMeetingPrepAutoGeneration(), (data) => ({
      itemsProcessed: data.generated,
      itemsChanged: data.generated,
      notes: `generated=${data.generated}`,
    })),
  ]);
  Object.assign(result.stepRuns || {}, {
    email_surface: emailSurfaceStep.state,
    batch_review: batchReviewStep.state,
    meeting_prep: meetingPrepStep.state,
  });

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
  const healthStep = await runStep("health_monitor", 15, () => runOperatorHealthMonitor(), (data) => ({
    itemsProcessed: data.checks.length,
    itemsChanged: data.ok ? 0 : 1,
    notes: data.ok ? "all green" : "degraded",
    result: data.ok ? "success" : "partial",
  }));
  result.health = healthStep.data || {
    ok: healthStep.state.result === "success",
    checks: [],
  };
  Object.assign(result.stepRuns || {}, {
    health_monitor: healthStep.state,
  });
  return result;
}
