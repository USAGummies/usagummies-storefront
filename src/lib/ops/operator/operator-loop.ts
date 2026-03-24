import { detectQBOOperatorGaps } from "@/lib/ops/operator/gap-detectors/qbo";
import { createOperatorTasks, executeOperatorTasks } from "@/lib/ops/operator/task-executor";
import { reportOperatorCycle } from "@/lib/ops/operator/task-reporter";

export type OperatorLoopResult = {
  createdTasks: number;
  pendingTasks: number;
  detectorSummary: {
    uncategorized: number;
    missingVendors: number;
    zeroRevenueAccounts: number;
    unrecordedKnownTransactions: number;
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

export async function runOperatorLoop(): Promise<OperatorLoopResult> {
  const detected = await detectQBOOperatorGaps();
  const createdTasks = await createOperatorTasks(detected.tasks);
  const execution = await executeOperatorTasks(12);
  const pendingTasks = await getPendingCount();

  const result: OperatorLoopResult = {
    createdTasks,
    pendingTasks,
    detectorSummary: detected.summary,
    execution,
  };

  await reportOperatorCycle(result);
  return result;
}
