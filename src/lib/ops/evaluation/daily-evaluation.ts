import { getPromptVersion } from "@/lib/ops/prompt-version";

export type StableQuery = {
  query: string;
  maxMs: number;
  mustContain?: string;
  mustNotContain?: string;
  maxLength?: number;
  category: "quick" | "finance" | "knowledge" | "action" | "rene" | "edge";
  actor?: "rene" | "ben";
};

export const STABLE_QUERIES: StableQuery[] = [
  { query: "rev", maxMs: 2000, mustContain: "$", category: "quick" },
  { query: "cash", maxMs: 2000, mustContain: "$", category: "quick" },
  { query: "pnl", maxMs: 3000, mustContain: "Revenue", category: "quick" },
  { query: "vendors", maxMs: 3000, mustContain: "vendor", category: "quick" },
  { query: "tasks", maxMs: 2000, category: "quick" },
  { query: "help", maxMs: 1000, category: "quick" },
  { query: "show me the P&L", maxMs: 10000, mustContain: "Revenue", category: "finance" },
  { query: "what is our cash position", maxMs: 10000, mustContain: "$", category: "finance" },
  { query: "balance sheet", maxMs: 10000, category: "finance" },
  { query: "what vendors are set up", maxMs: 10000, category: "finance" },
  { query: "show me recent transactions", maxMs: 10000, category: "finance" },
  { query: "what is our forward COGS per unit", maxMs: 15000, mustContain: "1.5", category: "knowledge" },
  { query: "how much has Rene invested", maxMs: 15000, mustContain: "100", category: "knowledge" },
  { query: "what is the shelf life", maxMs: 15000, mustContain: "18", category: "knowledge" },
  { query: "what is our priority order", maxMs: 15000, mustContain: "signal", category: "knowledge" },
  { query: "wholesale price for Inderbitzin", maxMs: 15000, mustContain: "2.10", category: "knowledge" },
  { query: "categorize the test charge to software", maxMs: 15000, mustNotContain: "I can't", category: "action" },
  { query: "export vendor list as Excel", maxMs: 20000, mustContain: "xlsx", category: "action" },
  { query: "search my email for Powers", maxMs: 20000, mustContain: "Powers", category: "action" },
  { query: "transactions", maxMs: 5000, maxLength: 2000, category: "rene", actor: "rene" },
  { query: "what needs my attention", maxMs: 15000, category: "rene", actor: "rene" },
  { query: "?", maxMs: 5000, mustNotContain: "error", category: "edge" },
  { query: "ok", maxMs: 5000, mustNotContain: "error", category: "edge" },
  { query: "how are things going", maxMs: 15000, category: "edge" },
  { query: "what is the weather in Spokane", maxMs: 15000, category: "edge" },
];

export const RED_LINES = {
  quick_command_p95_ms: 3000,
  finance_query_p95_ms: 15000,
  empty_reply_count: 0,
  error_reply_count: 0,
  wrong_data_count: 0,
  overall_pass_rate: 0.92,
} as const;

export type EvaluationResult = {
  query: string;
  category: StableQuery["category"];
  actor: "rene" | "ben";
  ms: number;
  passed: boolean;
  status: number;
  mustContainPassed: boolean;
  mustNotContainPassed: boolean;
  maxLengthPassed: boolean;
  error: string | null;
  promptVersion: string | null;
  replyPreview: string;
};

export type EvaluationRun = {
  promptVersion: string;
  totalQueries: number;
  passed: number;
  failed: number;
  avgMsByCategory: Record<string, number | null>;
  p95MsByCategory: Record<string, number | null>;
  redLinesCrossed: string[];
  results: EvaluationResult[];
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return baseUrl && serviceKey ? { baseUrl, serviceKey } : null;
}

function percentile95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] ?? null;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

async function postControlAlert(text: string): Promise<void> {
  const token = (process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "C0ATUGGUZL6",
      text,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

async function persistEvaluationRun(run: EvaluationRun): Promise<boolean> {
  const env = getSupabaseEnv();
  if (!env) return false;
  const res = await fetch(`${env.baseUrl}/rest/v1/abra_evaluation_runs`, {
    method: "POST",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      prompt_version: run.promptVersion,
      total_queries: run.totalQueries,
      passed: run.passed,
      failed: run.failed,
      avg_ms_quick: run.avgMsByCategory.quick,
      avg_ms_finance: run.avgMsByCategory.finance,
      avg_ms_knowledge: run.avgMsByCategory.knowledge,
      avg_ms_action: run.avgMsByCategory.action,
      red_lines_crossed: run.redLinesCrossed,
      results: run.results,
    }),
    signal: AbortSignal.timeout(20000),
  });
  return res.ok;
}

export async function runDailyEvaluation(baseUrl?: string): Promise<EvaluationRun> {
  const siteUrl =
    baseUrl ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://www.usagummies.com";
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
  };
  const results: EvaluationResult[] = [];

  for (const warmupQuery of ["help", "rev", "cash", "pnl"]) {
    await fetch(`${siteUrl}/api/ops/abra/chat`, {
      method: "POST",
      headers,
        body: JSON.stringify({
          message: warmupQuery,
          channel: "slack",
          slack_channel_id: "C0ATWJDKLTU",
          actor_label: "ben",
        }),
      signal: AbortSignal.timeout(12000),
    }).catch(() => null);
  }

  for (const test of STABLE_QUERIES) {
    const actor = test.actor || "ben";
    const startedAt = Date.now();
    let status = 500;
    let reply = "";
    let promptVersion: string | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(`${siteUrl}/api/ops/abra/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: test.query,
          channel: "slack",
          slack_channel_id: actor === "rene" ? "C0ATF50QQ1M" : "C0ATWJDKLTU",
          actor_label: actor,
        }),
        signal: AbortSignal.timeout(Math.max(test.maxMs + 5000, 12000)),
      });
      status = response.status;
      const payload = await response.json().catch(() => ({}));
      reply = typeof payload.reply === "string" ? payload.reply : "";
      promptVersion =
        typeof payload.prompt_version === "string"
          ? payload.prompt_version
          : null;
      if (!response.ok) {
        error = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const ms = Date.now() - startedAt;
    const mustContainPassed = test.mustContain
      ? reply.toLowerCase().includes(test.mustContain.toLowerCase())
      : true;
    const mustNotContainPassed = test.mustNotContain
      ? !reply.toLowerCase().includes(test.mustNotContain.toLowerCase())
      : true;
    const maxLengthPassed = test.maxLength ? reply.length <= test.maxLength : true;
    const passed =
      !error &&
      reply.trim().length > 0 &&
      status >= 200 &&
      status < 300 &&
      ms <= test.maxMs &&
      mustContainPassed &&
      mustNotContainPassed &&
      maxLengthPassed;

    results.push({
      query: test.query,
      category: test.category,
      actor,
      ms,
      passed,
      status,
      mustContainPassed,
      mustNotContainPassed,
      maxLengthPassed,
      error,
      promptVersion,
      replyPreview: reply.slice(0, 280),
    });
  }

  const promptVersion =
    results.find((row) => row.promptVersion)?.promptVersion ||
    getPromptVersion().version;
  const timingsByCategory = results.reduce<Record<string, number[]>>((acc, row) => {
    acc[row.category] ||= [];
    acc[row.category].push(row.ms);
    return acc;
  }, {});
  const avgMsByCategory = Object.fromEntries(
    Object.entries(timingsByCategory).map(([category, values]) => [
      category,
      average(values),
    ]),
  );
  const p95MsByCategory = Object.fromEntries(
    Object.entries(timingsByCategory).map(([category, values]) => [
      category,
      percentile95(values),
    ]),
  );

  const emptyReplyCount = results.filter((row) => row.replyPreview.trim().length === 0).length;
  const errorReplyCount = results.filter(
    (row) => row.error || /error/i.test(row.replyPreview),
  ).length;
  const wrongDataCount = results.filter(
    (row) => !row.mustContainPassed || !row.mustNotContainPassed || !row.maxLengthPassed,
  ).length;
  const passRate = results.filter((row) => row.passed).length / results.length;

  const redLinesCrossed: string[] = [];
  if ((p95MsByCategory.quick ?? 0) > RED_LINES.quick_command_p95_ms) {
    redLinesCrossed.push(
      `Quick command p95 is ${p95MsByCategory.quick}ms (limit ${RED_LINES.quick_command_p95_ms}ms)`,
    );
  }
  if ((p95MsByCategory.finance ?? 0) > RED_LINES.finance_query_p95_ms) {
    redLinesCrossed.push(
      `Finance query p95 is ${p95MsByCategory.finance}ms (limit ${RED_LINES.finance_query_p95_ms}ms)`,
    );
  }
  if (emptyReplyCount > RED_LINES.empty_reply_count) {
    redLinesCrossed.push(`Empty replies detected: ${emptyReplyCount}`);
  }
  if (errorReplyCount > RED_LINES.error_reply_count) {
    redLinesCrossed.push(`Error replies detected: ${errorReplyCount}`);
  }
  if (wrongDataCount > RED_LINES.wrong_data_count) {
    redLinesCrossed.push(`Wrong-data replies detected: ${wrongDataCount}`);
  }
  if (passRate < RED_LINES.overall_pass_rate) {
    redLinesCrossed.push(`Overall pass rate ${passRate.toFixed(2)} below ${RED_LINES.overall_pass_rate}`);
  }

  const run: EvaluationRun = {
    promptVersion,
    totalQueries: results.length,
    passed: results.filter((row) => row.passed).length,
    failed: results.filter((row) => !row.passed).length,
    avgMsByCategory,
    p95MsByCategory,
    redLinesCrossed,
    results,
  };

  await persistEvaluationRun(run).catch(() => false);

  const slowQuick = results.some(
    (row) => row.category === "quick" && row.ms > 2000,
  );
  if (run.passed < 23 || slowQuick || redLinesCrossed.length > 0) {
    await postControlAlert(
      `🔴 RED LINE CROSSED: evaluation ${run.passed}/${run.totalQueries}, quick p95 ${p95MsByCategory.quick ?? "n/a"}ms, finance p95 ${p95MsByCategory.finance ?? "n/a"}ms. ${redLinesCrossed.join(" | ")}`,
    );
  }

  return run;
}
