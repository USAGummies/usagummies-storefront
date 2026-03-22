/**
 * Anomaly-Triggered Deep Dive
 *
 * When the signal engine detects an anomaly, this module auto-runs
 * a comprehensive investigation: pulls related data, checks historical
 * patterns, generates hypotheses, and posts a full investigation brief.
 */

import { notifyAlert } from "@/lib/ops/notify";
import type { Signal } from "./signal-engine";

export type DeepDiveResult = {
  signal: Signal;
  investigation: string;
  hypotheses: string[];
  verdict: "expected" | "concerning" | "critical" | "unknown";
  recommendedAction: string;
  timestamp: string;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function getHistoricalPattern(metricName: string, days: number): Promise<Array<{ date: string; value: number }>> {
  const env = getSupabaseEnv();
  if (!env) return [];

  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `${env.baseUrl}/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=eq.${metricName}&captured_for_date=gte.${since}&select=captured_for_date,value&order=captured_for_date.asc&limit=100`,
      {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];
    return (await res.json()) as Array<{ date: string; value: number }>;
  } catch { return []; }
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr);
  return d.getDay() === 0 || d.getDay() === 6;
}

export async function investigateRevenueAnomaly(signal: Signal): Promise<DeepDiveResult> {
  const data = signal.data as { today: number; yesterday: number; dates: string[] };
  const hypotheses: string[] = [];
  let verdict: DeepDiveResult["verdict"] = "unknown";
  let recommendedAction = "Monitor for 24h before taking action";

  // Check if it's a weekend (lower revenue expected)
  if (data.dates?.[0] && isWeekend(data.dates[0])) {
    hypotheses.push("Weekend effect — revenue typically drops 40-60% on Sat/Sun");
    verdict = "expected";
    recommendedAction = "No action needed — normal weekend pattern";
  }

  // Check historical pattern (last 14 days)
  const history = await getHistoricalPattern("daily_revenue_amazon", 14);
  if (history.length >= 7) {
    const avg = history.reduce((s, h) => s + (Number(h.value) || 0), 0) / history.length;
    const stdDev = Math.sqrt(history.reduce((s, h) => s + Math.pow((Number(h.value) || 0) - avg, 2), 0) / history.length);
    const zScore = avg > 0 ? (data.today - avg) / (stdDev || 1) : 0;

    if (Math.abs(zScore) < 2) {
      hypotheses.push(`Within normal range (z-score: ${zScore.toFixed(1)}, avg: $${avg.toFixed(2)}/day)`);
      if (verdict === "unknown") verdict = "expected";
    } else {
      hypotheses.push(`Outside normal range (z-score: ${zScore.toFixed(1)}, avg: $${avg.toFixed(2)}/day)`);
      verdict = "concerning";
      recommendedAction = "Check Amazon PPC spend, listing status, and inventory availability";
    }
  }

  // Check if Amazon PPC budget might be exhausted
  const hour = new Date().getHours();
  if (data.today < data.yesterday * 0.3 && hour > 14) {
    hypotheses.push("Possible Amazon PPC daily budget exhaustion (revenue dropped after 2pm)");
  }

  // Check if it's month-end (Amazon settlement timing)
  const dayOfMonth = new Date().getDate();
  if (dayOfMonth >= 28) {
    hypotheses.push("Month-end — Amazon settlements may affect order processing");
  }

  const investigation = [
    `📉 Revenue dropped from $${data.yesterday?.toFixed(2)} → $${data.today?.toFixed(2)}`,
    "",
    "**Hypotheses:**",
    ...hypotheses.map((h, i) => `${i + 1}. ${h}`),
    "",
    `**Verdict:** ${verdict.toUpperCase()}`,
    `**Action:** ${recommendedAction}`,
  ].join("\n");

  return {
    signal,
    investigation,
    hypotheses,
    verdict,
    recommendedAction,
    timestamp: new Date().toISOString(),
  };
}

export async function runDeepDive(signal: Signal): Promise<DeepDiveResult> {
  if (signal.type === "revenue_anomaly") {
    return investigateRevenueAnomaly(signal);
  }

  // Generic deep dive for other signal types
  return {
    signal,
    investigation: `Signal detected: ${signal.title}. ${signal.detail}`,
    hypotheses: ["Automated investigation not yet available for this signal type"],
    verdict: "unknown",
    recommendedAction: "Manual investigation recommended",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Run deep dive and post to Slack.
 */
export async function investigateAndAlert(signal: Signal): Promise<DeepDiveResult> {
  const result = await runDeepDive(signal);

  const verdictEmoji = {
    expected: "✅",
    concerning: "⚠️",
    critical: "🚨",
    unknown: "❓",
  }[result.verdict];

  const msg = [
    `🔍 *Anomaly Investigation — ${signal.title}*`,
    "",
    result.investigation,
  ].join("\n");

  if (result.verdict === "critical" || result.verdict === "concerning") {
    void notifyAlert(msg);
  }

  return result;
}
