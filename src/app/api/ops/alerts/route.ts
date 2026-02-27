import { NextRequest, NextResponse } from "next/server";
import type { CacheEnvelope } from "@/lib/amazon/types";
import type { PlaidTransaction } from "@/lib/finance/types";
import { readState, writeState } from "@/lib/ops/state";
import { runOpsAudit } from "@/lib/ops/audit-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

type AlertPriority = "critical" | "warning" | "info";

type OpsAlert = {
  id: string;
  priority: AlertPriority;
  source: string;
  title: string;
  message: string;
  createdAt: string;
  actionLabel: string | null;
  actionHref: string | null;
  status: "open";
};

type AlertsResponse = {
  alerts: OpsAlert[];
  summary: {
    critical: number;
    warning: number;
    info: number;
    total: number;
  };
  generatedAt: string;
  lastFetched: string;
  budget: null;
};

type ForecastCache = {
  alerts?: string[];
  runway?: number;
};

type SupplyChainCache = {
  alerts?: Array<{
    type?: string;
    severity?: "critical" | "warning" | "info";
    message?: string;
    dueDate?: string | null;
    relatedItem?: string;
  }>;
};

type TransactionsCache = {
  response?: {
    transactions?: PlaidTransaction[];
  };
};

type PipelineCache = {
  stages?: Record<
    string,
    Array<{
      name?: string;
      lastEdited?: string;
    }>
  >;
};

function rankPriority(priority: AlertPriority): number {
  if (priority === "critical") return 0;
  if (priority === "warning") return 1;
  return 2;
}

function cleanId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function isRecentISODate(isoDate: string, withinDays: number): boolean {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= withinDays * 24 * 60 * 60 * 1000;
}

function summarize(alerts: OpsAlert[]) {
  return {
    critical: alerts.filter((a) => a.priority === "critical").length,
    warning: alerts.filter((a) => a.priority === "warning").length,
    info: alerts.filter((a) => a.priority === "info").length,
    total: alerts.length,
  };
}

async function buildAlerts(): Promise<AlertsResponse> {
  const [audit, forecastCache, supplyChainCache, txCache, pipelineCache] =
    await Promise.all([
      runOpsAudit(),
      readState<CacheEnvelope<ForecastCache> | null>("forecast-cache", null),
      readState<CacheEnvelope<SupplyChainCache> | null>(
        "supply-chain-cache",
        null,
      ),
      readState<CacheEnvelope<TransactionsCache> | null>(
        "transactions-cache",
        null,
      ),
      readState<CacheEnvelope<PipelineCache> | null>("pipeline-cache", null),
    ]);

  const alerts: OpsAlert[] = [];

  // Audit rule alerts
  for (const rule of audit.rules) {
    if (rule.status === "pass") continue;
    const priority: AlertPriority =
      rule.status === "fail"
        ? "critical"
        : rule.status === "warn"
          ? "warning"
          : "info";
    alerts.push({
      id: cleanId(`audit-${rule.id}`),
      priority,
      source: "audit",
      title: `Audit: ${rule.name}`,
      message: rule.summary,
      createdAt: audit.generatedAt,
      actionLabel: "Open audit",
      actionHref: "/ops/alerts?tab=audit",
      status: "open",
    });
  }

  // Freshness alerts
  for (const entry of audit.freshness) {
    if (entry.status !== "stale" && entry.status !== "critical") continue;
    const priority: AlertPriority =
      entry.status === "critical" ? "critical" : "warning";
    const ageText = entry.ageMinutes != null ? `${entry.ageMinutes}m old` : "missing";
    alerts.push({
      id: cleanId(`freshness-${entry.stateKey}`),
      priority,
      source: "freshness",
      title: `${entry.source} data is ${entry.status}`,
      message: `${entry.source} cache is ${ageText}.`,
      createdAt: audit.generatedAt,
      actionLabel: "Refresh source",
      actionHref: "/ops/alerts?tab=freshness",
      status: "open",
    });
  }

  // Forecast alerts
  for (const forecastAlert of forecastCache?.data?.alerts || []) {
    const critical = /negative|runway|below/i.test(forecastAlert);
    alerts.push({
      id: cleanId(`forecast-${forecastAlert.slice(0, 50)}`),
      priority: critical ? "critical" : "warning",
      source: "forecast",
      title: "Cash flow projection alert",
      message: forecastAlert,
      createdAt: forecastCache
        ? new Date(forecastCache.cachedAt).toISOString()
        : new Date().toISOString(),
      actionLabel: "Open finance",
      actionHref: "/ops/finance",
      status: "open",
    });
  }

  // Supply chain alerts
  for (const supplyAlert of supplyChainCache?.data?.alerts || []) {
    alerts.push({
      id: cleanId(
        `supply-${supplyAlert.type || "alert"}-${supplyAlert.relatedItem || ""}`,
      ),
      priority: supplyAlert.severity || "warning",
      source: "supply-chain",
      title: "Supply chain alert",
      message: supplyAlert.message || "Supply chain exception detected.",
      createdAt: supplyChainCache
        ? new Date(supplyChainCache.cachedAt).toISOString()
        : new Date().toISOString(),
      actionLabel: "Open supply chain",
      actionHref: "/ops/supply-chain",
      status: "open",
    });
  }

  // Large recent expense alerts
  const recentLargeExpenses = (txCache?.data?.response?.transactions || [])
    .filter((tx) => tx.amount > 1000 && !tx.pending && isRecentISODate(tx.date, 7))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  for (const tx of recentLargeExpenses) {
    const amount = `$${Math.round(tx.amount).toLocaleString()}`;
    alerts.push({
      id: cleanId(`txn-${tx.transactionId}`),
      priority: "warning",
      source: "transactions",
      title: "Large expense detected",
      message: `${tx.merchantName || tx.name} posted ${amount} on ${tx.date}.`,
      createdAt: `${tx.date}T00:00:00.000Z`,
      actionLabel: "Open transactions",
      actionHref: "/ops/finance",
      status: "open",
    });
  }

  // Pipeline stale-lead alert
  const staleLeads: string[] = [];
  for (const [stage, leads] of Object.entries(pipelineCache?.data?.stages || {})) {
    if (/closed|lost|not interested/i.test(stage)) continue;
    for (const lead of leads || []) {
      if (!lead.lastEdited) continue;
      if (!isRecentISODate(lead.lastEdited, 14)) {
        staleLeads.push(lead.name || "Unnamed lead");
      }
    }
  }

  if (staleLeads.length > 0) {
    alerts.push({
      id: "pipeline-stale-leads",
      priority: "warning",
      source: "pipeline",
      title: "Stale pipeline follow-ups",
      message: `${staleLeads.length} active leads have no update in 14+ days.`,
      createdAt: pipelineCache
        ? new Date(pipelineCache.cachedAt).toISOString()
        : new Date().toISOString(),
      actionLabel: "Open pipeline",
      actionHref: "/ops/pipeline",
      status: "open",
    });
  }

  // De-duplicate, then sort by priority and recency
  const deduped = Array.from(new Map(alerts.map((a) => [a.id, a])).values()).sort(
    (a, b) => {
      const priorityDiff = rankPriority(a.priority) - rankPriority(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    },
  );

  const generatedAt = new Date().toISOString();
  return {
    alerts: deduped,
    summary: summarize(deduped),
    generatedAt,
    lastFetched: generatedAt,
    budget: null,
  };
}

export async function GET(req: NextRequest) {
  const forceRefresh = req.nextUrl.searchParams.get("force") === "1";
  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "50", 10) || 50, 1),
    200,
  );

  try {
    let payload: AlertsResponse;

    if (!forceRefresh) {
      const cached = await readState<CacheEnvelope<AlertsResponse> | null>(
        "alerts-cache",
        null,
      );
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
        payload = cached.data;
      } else {
        payload = await buildAlerts();
        await writeState("alerts-cache", {
          data: payload,
          cachedAt: Date.now(),
        });
      }
    } else {
      payload = await buildAlerts();
      await writeState("alerts-cache", {
        data: payload,
        cachedAt: Date.now(),
      });
    }

    return NextResponse.json({
      ...payload,
      alerts: payload.alerts.slice(0, limit),
    });
  } catch (err) {
    console.error("[alerts] Failed:", err);
    return NextResponse.json(
      {
        alerts: [],
        summary: {
          critical: 0,
          warning: 0,
          info: 0,
          total: 0,
        },
        generatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        budget: null,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
