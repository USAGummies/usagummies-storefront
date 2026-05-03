/**
 * GET|POST /api/ops/agents/dtc-revenue/run
 *
 * DTC Revenue Commander — daily Shopify pulse with day-over-day,
 * week-over-week, 7-day rolling, and MTD context.
 *
 * Per Ben's 2026-05-03 strategic plan ("DTC Revenue Commander").
 * Companion to the morning Executive Brief: brief carries yesterday's
 * Shopify revenue line; this commander adds the trend drill-down so
 * Ben can see whether the DTC business is accelerating or decaying.
 *
 * Data source: Supabase `kpi_timeseries` rows already populated by
 * `kpi-collector` cron (24h window). Pulls a 32-day window so MTD
 * (up to 31 days) plus week-over-week (8 days back) both have data.
 *
 * Channel: #ops-daily (same channel as the brief, separate post).
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { getChannel, slackChannelRef } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  aggregateDtcRevenue,
  type DtcDailyMetric,
} from "@/lib/sales/dtc-revenue/metrics";
import { composeDtcRevenueDigest } from "@/lib/sales/dtc-revenue/summarizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = "dtc-revenue-commander";
const WINDOW_DAYS = 32;
const FETCH_TIMEOUT_MS = 8_000;
const TARGET_CHANNEL = "ops-daily";

const RELEVANT_METRICS = [
  "daily_revenue_shopify",
  "daily_orders_shopify",
  "daily_revenue_amazon",
  "daily_orders_amazon",
];

interface KpiRow {
  metric_name: string;
  captured_for_date: string;
  value: number | string;
}

function getSupabaseEnv(): { baseUrl: string; serviceKey: string } | null {
  const baseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function fetchKpiWindow(
  asOf: Date,
  windowDays: number,
): Promise<{ rows: KpiRow[]; error: string | null }> {
  const env = getSupabaseEnv();
  if (!env) {
    return {
      rows: [],
      error:
        "Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset).",
    };
  }
  const since = new Date(asOf.getTime() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const yesterday = new Date(asOf.getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const url =
    `${env.baseUrl}/rest/v1/kpi_timeseries` +
    `?window_type=eq.daily` +
    `&captured_for_date=gte.${since}` +
    `&captured_for_date=lte.${yesterday}` +
    `&metric_name=in.(${RELEVANT_METRICS.join(",")})` +
    `&select=metric_name,captured_for_date,value` +
    `&limit=1000`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        rows: [],
        error: `kpi_timeseries HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as KpiRow[] | unknown;
    if (!Array.isArray(body)) {
      return { rows: [], error: "kpi_timeseries returned non-array body" };
    }
    return { rows: body as KpiRow[], error: null };
  } catch (err) {
    return {
      rows: [],
      error: `kpi_timeseries fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function projectMetrics(rows: readonly KpiRow[]): DtcDailyMetric[] {
  const byDate = new Map<string, DtcDailyMetric>();
  for (const r of rows) {
    const date = r.captured_for_date;
    if (!date) continue;
    const numericValue = typeof r.value === "string" ? Number(r.value) : r.value;
    const safeValue = Number.isFinite(numericValue) ? numericValue : null;
    let entry = byDate.get(date);
    if (!entry) {
      entry = {
        date,
        shopifyRevenue: null,
        shopifyOrders: null,
        amazonRevenue: null,
        amazonOrders: null,
      };
      byDate.set(date, entry);
    }
    switch (r.metric_name) {
      case "daily_revenue_shopify":
        entry.shopifyRevenue = safeValue;
        break;
      case "daily_orders_shopify":
        entry.shopifyOrders = safeValue;
        break;
      case "daily_revenue_amazon":
        entry.amazonRevenue = safeValue;
        break;
      case "daily_orders_amazon":
        entry.amazonOrders = safeValue;
        break;
    }
  }
  return Array.from(byDate.values());
}

interface RunResult {
  ok: boolean;
  runId: string;
  asOf: string;
  postedTo: string | null;
  rendered: string | null;
  yesterday: { date: string; shopifyRevenue: number | null; shopifyOrders: number | null };
  deltas: { dayOverDayPct: number | null; weekOverWeekPct: number | null };
  degraded: string[];
}

async function runAgent(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const shouldPost = url.searchParams.get("post") !== "false";

  const run = newRunContext({
    agentId: AGENT_ID,
    division: "sales",
    source: "scheduled",
    trigger: "weekday-morning-dtc-pulse",
  });

  const asOf = new Date();
  const degraded: string[] = [];

  // ---- Fetch KPI window ----
  const { rows, error } = await fetchKpiWindow(asOf, WINDOW_DAYS);
  if (error) degraded.push(error);
  const metrics = projectMetrics(rows);
  const digest = aggregateDtcRevenue(metrics, asOf);
  // Merge digest's own degraded list with the route's.
  for (const d of digest.degraded) degraded.push(d);

  // ---- Render ----
  const rendered = composeDtcRevenueDigest(digest);

  // ---- Post ----
  let postedTo: string | null = null;
  if (shouldPost && rendered) {
    if (getChannel(TARGET_CHANNEL)) {
      try {
        const res = await postMessage({
          channel: slackChannelRef(TARGET_CHANNEL),
          text: rendered,
        });
        if (res.ok) postedTo = `#${TARGET_CHANNEL}`;
        else degraded.push(`slack-post: ${res.error ?? "unknown error"}`);
      } catch (err) {
        degraded.push(
          `slack-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      degraded.push(`slack-post: #${TARGET_CHANNEL} channel not registered`);
    }
  }

  // ---- Audit envelope ----
  try {
    await auditStore().append(
      buildAuditEntry(run, {
        action: "slack.post.audit",
        entityType: "dtc-revenue-digest",
        entityId: digest.yesterday.date,
        result: "ok",
        after: {
          summary:
            digest.yesterday.shopifyRevenue !== null
              ? `Shopify yesterday $${digest.yesterday.shopifyRevenue.toFixed(2)} on ${digest.yesterday.shopifyOrders ?? 0} orders` +
                (digest.shopifyDeltas.dayOverDayPct !== null
                  ? ` (${digest.shopifyDeltas.dayOverDayPct >= 0 ? "+" : ""}${digest.shopifyDeltas.dayOverDayPct.toFixed(1)}% DoD)`
                  : "")
              : "DTC pulse — Shopify revenue unavailable for yesterday",
          yesterday: digest.yesterday,
          deltas: digest.shopifyDeltas,
          last7DaysRevenue: digest.last7Days.shopifyRevenue,
          mtdRevenue: digest.mtd.shopifyRevenue,
          postedTo,
          degraded,
        },
        sourceCitations: [
          {
            system: "kpi_timeseries:daily",
            id: digest.yesterday.date,
          },
        ],
        confidence: 1.0,
      }),
    );
  } catch (err) {
    degraded.push(
      `audit-store: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return NextResponse.json({
    ok: true,
    runId: run.runId,
    asOf: asOf.toISOString(),
    postedTo,
    rendered,
    yesterday: {
      date: digest.yesterday.date,
      shopifyRevenue: digest.yesterday.shopifyRevenue,
      shopifyOrders: digest.yesterday.shopifyOrders,
    },
    deltas: digest.shopifyDeltas,
    degraded,
  } satisfies RunResult);
}

export async function GET(req: Request): Promise<Response> {
  return runAgent(req);
}

export async function POST(req: Request): Promise<Response> {
  return runAgent(req);
}
