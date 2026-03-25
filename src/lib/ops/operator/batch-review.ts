import { readState, writeState } from "@/lib/ops/state";
import {
  FINANCIALS_CHANNEL_ID,
  RENE_SLACK_ID,
  currentPtDateParts,
  round2,
  uploadWorkbook,
} from "@/lib/ops/operator/reports/shared";

type ReviewTaskRow = {
  id: string;
  created_at: string;
  execution_params: Record<string, unknown> | null;
};

const STATE_KEY = "abra-operator-batch-review-last-run" as never;

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
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status})`);
  }
  return json as T;
}

export type BatchReviewResult = {
  ran: boolean;
  count: number;
};

function similarityKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\$?\d[\d,]*(\.\d+)?/g, " ")
    .replace(/\bvisa|debit|card|purchase|payment|pos|checkcard\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

export async function runBatchTransactionReview(force = false): Promise<BatchReviewResult> {
  const { isoDate } = currentPtDateParts();
  const lastRun = await readState<{ date?: string } | null>(STATE_KEY, null);
  if (!force && lastRun?.date === isoDate) {
    return { ran: false, count: 0 };
  }

  const rows = await sbFetch<ReviewTaskRow[]>(
    `/rest/v1/abra_operator_tasks?select=id,created_at,execution_params&task_type=eq.qbo_review_transaction&status=in.(pending,needs_approval)&order=created_at.asc&limit=200`,
  ).catch(() => []);
  const tasks = Array.isArray(rows) ? rows : [];
  if (tasks.length <= 5) {
    return { ran: false, count: tasks.length };
  }

  const sorted = tasks
    .map((task) => ({
      task,
      confidence: Number(task.execution_params?.confidence || 0),
      description: String(task.execution_params?.description || task.execution_params?.title || ""),
      groupKey: similarityKey(String(task.execution_params?.description || task.execution_params?.title || "")) || "misc",
    }))
    .sort((a, b) => {
      const byGroup = a.groupKey.localeCompare(b.groupKey);
      if (byGroup !== 0) return byGroup;
      return a.confidence - b.confidence;
    });

  await uploadWorkbook({
    channelId: FINANCIALS_CHANNEL_ID,
    filename: `rene-transaction-review-${isoDate}.xlsx`,
    comment:
      `<@${RENE_SLACK_ID}> — ${sorted.length} transactions need your input. I categorized the ones I recognized. ` +
      `The rest are in the attached file, grouped by similar descriptions.\n\n` +
      `Reply with corrections like:\n• row 5 is personal\n• row 12 is shipping\n• anything from ARCO is vehicle fuel`,
    sheets: [
      {
        sheetName: "Review",
        headers: ["Row #", "Group", "Date", "Amount", "Description", "Suggested Category", "Confidence %", "Task ID"],
        rows: sorted.map(({ task, confidence }, index) => [
          index + 1,
          String(task.execution_params?.description ? similarityKey(String(task.execution_params.description)) : "misc"),
          String(task.execution_params?.date || task.created_at).slice(0, 10),
          round2(Number(task.execution_params?.amount || 0)),
          String(task.execution_params?.description || task.execution_params?.title || ""),
          String(task.execution_params?.suggestedAccountName || "Needs Rene input"),
          confidence,
          task.id,
        ]),
      },
    ],
  });

  await writeState(STATE_KEY, { date: isoDate });
  return { ran: true, count: sorted.length };
}
