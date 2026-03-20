/**
 * KPI Sync Cron — pulls live numbers from Shopify, Amazon, and QBO into
 * the kpi_timeseries Supabase table so the morning brief is always fresh.
 *
 * Idempotent: safe to call multiple times per day. The underlying recordKPI
 * helper deletes the existing row for metric+date before inserting, so
 * repeated calls just refresh the values.
 *
 * Auth: CRON_SECRET bearer token (same pattern as /collect-kpis).
 * Trigger: QStash schedule (since Vercel Hobby allows only 1 cron/day).
 *
 * QStash setup — run once to create a schedule that fires every 6 hours:
 *   curl -X POST https://qstash.upstash.io/v2/schedules \
 *     -H "Authorization: Bearer $QSTASH_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"destination":"https://usagummies.com/api/ops/abra/cron/kpi-sync",
 *           "cron":"0 6,12,18,0 * * *",
 *           "headers":{"Authorization":"Bearer <CRON_SECRET>"}}'
 */

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import {
  collectDailyKPIs,
  recordKPIs,
  type CollectedMetric,
} from "@/lib/ops/kpi-collector";
import { getQBOMetrics, isQBOConfigured } from "@/lib/ops/qbo-client";
import { recordKPI } from "@/lib/ops/abra-kpi-recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// QBO metric collector
// ---------------------------------------------------------------------------

async function collectQBOMetrics(): Promise<{
  metrics: CollectedMetric[];
  error: string | null;
}> {
  const configured = await isQBOConfigured().catch(() => false);
  if (!configured) {
    return { metrics: [], error: null }; // not connected — skip silently
  }

  const qbo = await getQBOMetrics().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  });

  if (!qbo || "error" in qbo) {
    return {
      metrics: [],
      error: qbo && "error" in qbo ? (qbo.error as string) : "QBO fetch failed",
    };
  }

  const metrics: CollectedMetric[] = [
    { key: "qbo_cash_position", value: qbo.cashPosition },
    { key: "qbo_total_revenue_30d", value: qbo.totalRevenue },
    { key: "qbo_total_expenses_30d", value: qbo.totalExpenses },
    { key: "qbo_net_income_30d", value: qbo.netIncome },
    { key: "qbo_accounts_receivable", value: qbo.accountsReceivable },
    { key: "qbo_accounts_payable", value: qbo.accountsPayable },
    { key: "qbo_burn_rate_monthly", value: qbo.burnRate },
    { key: "qbo_runway_months", value: Number.isFinite(qbo.runway) ? qbo.runway : 0 },
  ];

  return { metrics, error: null };
}

// ---------------------------------------------------------------------------
// Record QBO metrics with correct source/group labels
// ---------------------------------------------------------------------------

async function recordQBOMetrics(metrics: CollectedMetric[]): Promise<number> {
  let recorded = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const m of metrics) {
    try {
      await recordKPI({
        metric_name: m.key,
        value: m.value,
        date: today,
        source_system: "quickbooks",
        metric_group: m.key.includes("cash") || m.key.includes("runway") || m.key.includes("burn")
          ? "finance"
          : m.key.includes("revenue") || m.key.includes("income")
            ? "sales"
            : "finance",
      });
      recorded++;
    } catch {
      // non-fatal
    }
  }

  return recorded;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleSync(req: Request): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const collectionErrors: string[] = [];

  // Run all three sources in parallel
  const [kpiResult, qboResult] = await Promise.all([
    collectDailyKPIs().catch((err) => {
      collectionErrors.push(
        `KPI collector: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { metrics: [] as CollectedMetric[], errors: [] as string[] };
    }),
    collectQBOMetrics().catch((err) => {
      collectionErrors.push(
        `QBO: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { metrics: [] as CollectedMetric[], error: null };
    }),
  ]);

  // Merge collection errors
  collectionErrors.push(...kpiResult.errors);
  if (qboResult.error) collectionErrors.push(`QBO: ${qboResult.error}`);

  // Record all metrics
  const [shopifyAmazonRecorded, qboRecorded] = await Promise.all([
    recordKPIs(kpiResult.metrics).catch(() => 0),
    recordQBOMetrics(qboResult.metrics).catch(() => 0),
  ]);

  const totalRecorded = shopifyAmazonRecorded + qboRecorded;
  const elapsedMs = Date.now() - started;

  // Build summary for response
  const shopifyMetric = kpiResult.metrics.find((m) => m.key === "daily_revenue_shopify");
  const amazonMetric = kpiResult.metrics.find((m) => m.key === "daily_revenue_amazon");
  const cashMetric = qboResult.metrics.find((m) => m.key === "qbo_cash_position");

  return NextResponse.json({
    ok: true,
    syncedAt: new Date().toISOString(),
    elapsedMs,
    recorded: totalRecorded,
    breakdown: {
      shopifyAmazon: shopifyAmazonRecorded,
      qbo: qboRecorded,
    },
    snapshot: {
      shopifyRevenueToday: shopifyMetric?.value ?? null,
      amazonRevenueToday: amazonMetric?.value ?? null,
      qboCashPosition: cashMetric?.value ?? null,
    },
    collectionErrors: collectionErrors.length > 0 ? collectionErrors : undefined,
  });
}

export async function POST(req: Request) {
  return handleSync(req);
}

// QStash sends POST, but allow GET for manual dashboard triggers
export async function GET(req: Request) {
  return handleSync(req);
}
