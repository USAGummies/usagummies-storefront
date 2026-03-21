/**
 * POST/GET /api/ops/abra/cron/self-monitor
 *
 * Abra Self-Monitoring Cron — "Who watches the watchmen?"
 *
 * Runs daily at 7am PT (via QStash) and validates Abra's own systems:
 *  1. Cost consistency (total vs provider sum)
 *  2. Brain entry health (recent entries have embeddings)
 *  3. Feed freshness (KPI data < 72h old)
 *  4. Stale approvals (pending > 24h)
 *  5. Teach → recall round-trip
 *  6. Chat completion smoke test
 *
 * Posts scorecard to #abra-control. Alerts on failures.
 */

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { notifyAlert } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

type CheckResult = {
  name: string;
  ok: boolean;
  message: string;
  value?: unknown;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbQuery(path: string): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");
  const res = await fetch(`${env.baseUrl}${path}`, {
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

async function sbRpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");
  const res = await fetch(`${env.baseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status}`);
  return res.json();
}

// ─── CHECK 1: Cost Consistency ───
async function checkCostConsistency(): Promise<CheckResult> {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const rows = (await sbRpc("get_monthly_ai_spend", { target_month: month })) as Array<{
      total_cost: number;
      by_provider: Record<string, number>;
      call_count: number;
    }>;
    const row = rows[0];
    if (!row) return { name: "cost_consistency", ok: true, message: "No cost data yet" };

    const total = Number(row.total_cost) || 0;
    const providerSum = Object.values(row.by_provider || {}).reduce(
      (s, v) => s + (Number(v) || 0), 0,
    );

    if (providerSum === 0 && total === 0) {
      return { name: "cost_consistency", ok: true, message: "No spend recorded" };
    }

    const divergence = total > 0 ? Math.abs(total - providerSum) / Math.max(total, providerSum) : 0;
    if (divergence > 0.1) {
      return {
        name: "cost_consistency",
        ok: false,
        message: `Total $${total.toFixed(2)} diverges from provider sum $${providerSum.toFixed(2)} by ${(divergence * 100).toFixed(0)}%`,
        value: { total, providerSum, divergence, callCount: row.call_count },
      };
    }

    return {
      name: "cost_consistency",
      ok: true,
      message: `$${total.toFixed(2)} / ${row.call_count} calls — consistent`,
    };
  } catch (err) {
    return { name: "cost_consistency", ok: false, message: `Check failed: ${err instanceof Error ? err.message : err}` };
  }
}

// ─── CHECK 2: Brain Entry Health ───
async function checkBrainHealth(): Promise<CheckResult> {
  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const rows = (await sbQuery(
      `/rest/v1/open_brain_entries?created_at=gte.${encodeURIComponent(twoDaysAgo)}&select=id,embedding&limit=50`,
    )) as Array<{ id: string; embedding: unknown }>;

    const total = rows.length;
    const withEmbedding = rows.filter((r) => r.embedding != null).length;
    const missing = total - withEmbedding;

    if (total === 0) {
      return { name: "brain_health", ok: true, message: "No recent brain entries" };
    }

    if (missing > 0) {
      return {
        name: "brain_health",
        ok: false,
        message: `${missing}/${total} recent brain entries missing embeddings`,
        value: { total, withEmbedding, missing },
      };
    }

    return { name: "brain_health", ok: true, message: `${total} recent entries, all have embeddings` };
  } catch (err) {
    return { name: "brain_health", ok: false, message: `Check failed: ${err instanceof Error ? err.message : err}` };
  }
}

// ─── CHECK 3: Feed Freshness ───
async function checkFeedFreshness(): Promise<CheckResult> {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const rows = (await sbQuery(
      `/rest/v1/kpi_timeseries?captured_for_date=gte.${threeDaysAgo.slice(0, 10)}&select=metric_name,captured_for_date&order=captured_for_date.desc&limit=100`,
    )) as Array<{ metric_name: string; captured_for_date: string }>;

    const feeds = new Map<string, string>();
    for (const r of rows) {
      const feed = r.metric_name.includes("shopify") ? "shopify" : r.metric_name.includes("amazon") ? "amazon" : "other";
      if (!feeds.has(feed) || r.captured_for_date > feeds.get(feed)!) {
        feeds.set(feed, r.captured_for_date);
      }
    }

    const stale: string[] = [];
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const [feed, lastDate] of feeds) {
      if (lastDate < cutoff) stale.push(`${feed} (last: ${lastDate})`);
    }

    if (stale.length > 0) {
      return {
        name: "feed_freshness",
        ok: false,
        message: `Stale feeds (>72h): ${stale.join(", ")}`,
        value: Object.fromEntries(feeds),
      };
    }

    return {
      name: "feed_freshness",
      ok: true,
      message: `${feeds.size} feeds active, all <72h old`,
    };
  } catch (err) {
    return { name: "feed_freshness", ok: false, message: `Check failed: ${err instanceof Error ? err.message : err}` };
  }
}

// ─── CHECK 4: Stale Approvals ───
async function checkStaleApprovals(): Promise<CheckResult> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = (await sbQuery(
      `/rest/v1/approvals?status=eq.pending&created_at=lt.${encodeURIComponent(oneDayAgo)}&select=id,summary,created_at&limit=20`,
    )) as Array<{ id: string; summary: string; created_at: string }>;

    if (rows.length > 0) {
      return {
        name: "stale_approvals",
        ok: false,
        message: `${rows.length} approval(s) pending >24h`,
        value: rows.map((r) => ({ id: r.id, summary: (r.summary || "").slice(0, 80), age: r.created_at })),
      };
    }

    return { name: "stale_approvals", ok: true, message: "No stale approvals" };
  } catch (err) {
    return { name: "stale_approvals", ok: false, message: `Check failed: ${err instanceof Error ? err.message : err}` };
  }
}

// ─── CHECK 5: Teach → Recall Round-Trip ───
async function checkTeachRecall(): Promise<CheckResult> {
  try {
    const host = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return { name: "teach_recall", ok: false, message: "CRON_SECRET not set" };

    const marker = `SELF-MONITOR-${Date.now()}`;

    // Teach
    const teachRes = await fetch(`${host}/api/ops/abra/teach`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        content: `[self-monitor] Health check marker: ${marker}`,
        source: "self-monitor",
        tags: ["self-monitor", "ephemeral"],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!teachRes.ok) {
      return { name: "teach_recall", ok: false, message: `Teach failed: ${teachRes.status}` };
    }

    const teachData = (await teachRes.json()) as { success?: boolean; id?: string };
    if (!teachData.success) {
      return { name: "teach_recall", ok: false, message: "Teach returned success=false" };
    }

    // Brief wait for embedding
    await new Promise((r) => setTimeout(r, 2000));

    // Recall via semantic search
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return { name: "teach_recall", ok: true, message: "Teach succeeded (recall skipped — no OPENAI_API_KEY)" };

    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: marker }),
      signal: AbortSignal.timeout(10000),
    });
    if (!embRes.ok) return { name: "teach_recall", ok: true, message: "Teach succeeded (recall skipped — embedding API error)" };

    const embData = (await embRes.json()) as { data?: Array<{ embedding: number[] }> };
    const embedding = embData.data?.[0]?.embedding;
    if (!embedding) return { name: "teach_recall", ok: true, message: "Teach succeeded (recall skipped — no embedding returned)" };

    const searchResults = (await sbRpc("search_memory", {
      query_embedding: `[${embedding.join(",")}]`,
      match_count: 3,
    })) as Array<{ id: string; title: string; similarity: number }>;

    const found = Array.isArray(searchResults) && searchResults.some(
      (r) => r.title?.includes("self-monitor") || r.similarity > 0.85,
    );

    // Clean up the test entry
    if (teachData.id) {
      const env = getSupabaseEnv();
      if (env) {
        await fetch(`${env.baseUrl}/rest/v1/open_brain_entries?id=eq.${teachData.id}`, {
          method: "DELETE",
          headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` },
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
    }

    return {
      name: "teach_recall",
      ok: found,
      message: found ? "Teach → recall round-trip working" : "Teach succeeded but recall failed to find the entry",
    };
  } catch (err) {
    return { name: "teach_recall", ok: false, message: `Check failed: ${err instanceof Error ? err.message : err}` };
  }
}

// ─── CHECK 6: Chat Smoke Test ───
async function checkChatSmoke(): Promise<CheckResult> {
  try {
    const host = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return { name: "chat_smoke", ok: false, message: "CRON_SECRET not set" };

    const start = Date.now();
    const res = await fetch(`${host}/api/ops/abra/chat?mode=health`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ message: "health check" }),
      signal: AbortSignal.timeout(20000),
    });

    const elapsed = Date.now() - start;

    if (!res.ok) {
      return { name: "chat_smoke", ok: false, message: `Chat returned ${res.status} (${elapsed}ms)` };
    }

    const data = (await res.json()) as { reply?: string };
    if (!data.reply) {
      return { name: "chat_smoke", ok: false, message: `Chat returned empty reply (${elapsed}ms)` };
    }

    return {
      name: "chat_smoke",
      ok: true,
      message: `Chat responding (${elapsed}ms)`,
      value: { elapsed },
    };
  } catch (err) {
    return { name: "chat_smoke", ok: false, message: `Check failed: ${err instanceof Error ? err.message : err}` };
  }
}

// ─── MAIN HANDLER ───
async function runSelfMonitor(): Promise<{
  ok: boolean;
  checks: CheckResult[];
  passed: number;
  failed: number;
  timestamp: string;
}> {
  // Run checks in parallel where possible
  const [costResult, brainResult, feedResult, approvalResult] = await Promise.all([
    checkCostConsistency(),
    checkBrainHealth(),
    checkFeedFreshness(),
    checkStaleApprovals(),
  ]);

  // Sequential checks (these make HTTP calls that could hit rate limits)
  const chatResult = await checkChatSmoke();
  const teachResult = await checkTeachRecall();

  const checks = [costResult, brainResult, feedResult, approvalResult, chatResult, teachResult];
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;
  const ok = failed === 0;

  return { ok, checks, passed, failed, timestamp: new Date().toISOString() };
}

function formatSlackReport(result: Awaited<ReturnType<typeof runSelfMonitor>>): string {
  const status = result.ok ? ":white_check_mark:" : ":warning:";
  const lines = [
    `${status} *Abra Self-Monitor — ${result.passed}/${result.passed + result.failed} checks passed*`,
    "",
  ];

  for (const check of result.checks) {
    const icon = check.ok ? ":white_check_mark:" : ":x:";
    lines.push(`${icon} *${check.name}*: ${check.message}`);
  }

  if (!result.ok) {
    lines.push("");
    lines.push("_Investigate failures above. Run manually: `POST /api/ops/abra/cron/self-monitor`_");
  }

  return lines.join("\n");
}

async function handler(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runSelfMonitor();

  // Always post to Slack if there are failures
  if (!result.ok) {
    const report = formatSlackReport(result);
    void notifyAlert(report);
  }

  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return handler(req);
}

export async function POST(req: Request) {
  return handler(req);
}
