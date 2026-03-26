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

type FlatQboPurchase = {
  Id?: string;
  Date?: string;
  Amount?: number;
  BankAccount?: string | null;
  Vendor?: string | null;
  Lines?: Array<{
    Description?: string | null;
    Account?: string | null;
  }>;
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

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    "https://www.usagummies.com"
  );
}

function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
}

async function fetchFlatPurchases(limit = 200): Promise<FlatQboPurchase[]> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/query?type=purchases&limit=${limit}`, {
    headers: {
      ...getInternalHeaders(),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { purchases?: FlatQboPurchase[] };
  return Array.isArray(data.purchases) ? data.purchases : [];
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

  const grouped = Array.from(
    sorted.reduce((map, item) => {
      const bucket = map.get(item.groupKey) || [];
      bucket.push(item);
      map.set(item.groupKey, bucket);
      return map;
    }, new Map<string, typeof sorted>()),
  )
    .map(([groupKey, items]) => ({
      groupKey,
      count: items.length,
      avgConfidence: items.length
        ? Math.round(items.reduce((sum, item) => sum + item.confidence, 0) / items.length)
        : 0,
      examples: items.slice(0, 3).map((item) => item.description).join(" | "),
    }))
    .sort((a, b) => b.count - a.count || a.avgConfidence - b.avgConfidence);

  const purchases = await fetchFlatPurchases(200).catch(() => []);
  const quicksilver = purchases.filter((purchase) => /quicksilverone/i.test(String(purchase.BankAccount || "")));
  const quicksilverRows = quicksilver.map((purchase) => {
    const line = Array.isArray(purchase.Lines) ? purchase.Lines[0] : null;
    return [
      String(purchase.Id || ""),
      String(purchase.Date || "").slice(0, 10),
      round2(Number(purchase.Amount || 0)),
      String(line?.Description || purchase.Vendor || ""),
      String(line?.Account || ""),
    ];
  });

  await uploadWorkbook({
    channelId: FINANCIALS_CHANNEL_ID,
    filename: `rene-transaction-review-${isoDate}.xlsx`,
    comment:
      `<@${RENE_SLACK_ID}> — I found ${grouped.length} groups of similar transactions (${sorted.length} total). ` +
      `I categorized the ones I recognized. The rest are in the attached file.\n\n` +
      `Reply with corrections like:\n• row 5 is personal\n• row 12 is shipping\n• anything from ARCO is vehicle fuel`,
    sheets: [
      {
        sheetName: "Groups",
        headers: ["Group", "Count", "Avg Confidence %", "Examples"],
        rows: grouped.map((group) => [
          group.groupKey,
          group.count,
          group.avgConfidence,
          group.examples,
        ]),
      },
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
      ...(quicksilverRows.length
        ? [{
            sheetName: "QuicksilverOne",
            headers: ["Transaction ID", "Date", "Amount", "Description", "Current Account"],
            rows: quicksilverRows,
          }]
        : []),
    ],
  });

  await writeState(STATE_KEY, { date: isoDate });
  return { ran: true, count: sorted.length };
}
