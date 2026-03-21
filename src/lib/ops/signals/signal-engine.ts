/**
 * Abra Proactive Signal Detection Engine
 *
 * Monitors all data streams and fires playbooks when actionable patterns
 * are detected. Runs as a sweep (every 30-60 min via QStash).
 *
 * Signals:
 *  1. Revenue anomaly (>25% day-over-day change)
 *  2. Low inventory alert (<30 days runway)
 *  3. Stale vendor communication (>7 days no response on open thread)
 *  4. Cash balance threshold (checking < $2,000)
 *  5. Return rate spike (>5% of orders)
 *  6. New wholesale inquiry (email pattern match)
 *  7. AI budget warning (>80% monthly spend)
 */

import { notifyAlert, notifyDaily } from "@/lib/ops/notify";

export type Signal = {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  data: Record<string, unknown>;
  timestamp: string;
};

export type SignalScanResult = {
  signals: Signal[];
  scanned: string[];
  errors: string[];
  timestamp: string;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbQuery<T = unknown>(path: string): Promise<T | null> {
  const env = getSupabaseEnv();
  if (!env) return null;
  try {
    const res = await fetch(`${env.baseUrl}${path}`, {
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Signal Detectors ───

async function checkRevenueAnomaly(): Promise<Signal | null> {
  const rows = await sbQuery<Array<{ metric_name: string; value: number; captured_for_date: string }>>(
    `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.(daily_revenue_shopify,daily_revenue_amazon)&order=captured_for_date.desc&limit=14`,
  );
  if (!rows || rows.length < 4) return null;

  // Sum by date
  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(r.captured_for_date, (byDate.get(r.captured_for_date) || 0) + (Number(r.value) || 0));
  }

  const dates = Array.from(byDate.keys()).sort().reverse();
  if (dates.length < 2) return null;

  const today = byDate.get(dates[0]) || 0;
  const yesterday = byDate.get(dates[1]) || 0;

  if (yesterday === 0) return null;
  const change = (today - yesterday) / yesterday;

  if (Math.abs(change) > 0.25) {
    const direction = change > 0 ? "spike" : "drop";
    return {
      type: "revenue_anomaly",
      severity: Math.abs(change) > 0.5 ? "critical" : "warning",
      title: `Revenue ${direction}: ${change > 0 ? "+" : ""}${(change * 100).toFixed(0)}% day-over-day`,
      detail: `${dates[0]}: $${today.toFixed(2)} vs ${dates[1]}: $${yesterday.toFixed(2)}`,
      data: { today, yesterday, change, dates: [dates[0], dates[1]] },
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

async function checkInventoryRunway(): Promise<Signal | null> {
  // Pull from brain for latest inventory data
  const rows = await sbQuery<Array<{ summary_text: string }>>(
    `/rest/v1/open_brain_entries?title=ilike.*inventory*&select=summary_text&order=created_at.desc&limit=1`,
  );
  if (!rows?.[0]?.summary_text) return null;

  const text = rows[0].summary_text;
  const unitsMatch = text.match(/(\d+)\s*units?\s*(remaining|left|on hand|in stock)/i);
  if (!unitsMatch) return null;

  const units = parseInt(unitsMatch[1]);
  // Use Amazon velocity (~6.7 units/day)
  const dailyVelocity = 6.7;
  const runwayDays = Math.round(units / dailyVelocity);

  if (runwayDays < 30) {
    return {
      type: "low_inventory",
      severity: runwayDays < 14 ? "critical" : "warning",
      title: `Inventory runway: ${runwayDays} days`,
      detail: `${units} units remaining at ${dailyVelocity} units/day velocity. ${runwayDays < 14 ? "CRITICAL — initiate production run immediately." : "Start planning next production run."}`,
      data: { units, dailyVelocity, runwayDays },
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

async function checkAIBudget(): Promise<Signal | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  try {
    const month = new Date().toISOString().slice(0, 7);
    const res = await fetch(`${env.baseUrl}/rest/v1/rpc/get_monthly_ai_spend`, {
      method: "POST",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target_month: month }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const rows = (await res.json()) as Array<{ total_cost: number; call_count: number }>;
    const row = rows[0];
    if (!row) return null;

    const budget = Number(process.env.ABRA_MONTHLY_BUDGET) || 1000;
    const pct = (row.total_cost / budget) * 100;
    const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();

    if (pct > 80) {
      return {
        type: "ai_budget_warning",
        severity: pct > 95 ? "critical" : "warning",
        title: `AI budget: ${pct.toFixed(0)}% used ($${row.total_cost.toFixed(2)} / $${budget})`,
        detail: `${daysLeft} days remaining in the month. ${row.call_count} API calls.`,
        data: { spend: row.total_cost, budget, pct, daysLeft, calls: row.call_count },
        timestamp: new Date().toISOString(),
      };
    }
  } catch {
    // Non-fatal
  }
  return null;
}

async function checkStaleVendorComms(): Promise<Signal | null> {
  // Check email_events for vendor threads with no response >7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await sbQuery<Array<{ from_address: string; subject: string; received_at: string }>>(
    `/rest/v1/email_events?direction=eq.inbound&received_at=lt.${encodeURIComponent(sevenDaysAgo)}&select=from_address,subject,received_at&order=received_at.desc&limit=20`,
  );
  if (!rows || rows.length === 0) return null;

  // Check for known vendor emails that haven't been replied to
  const vendorPatterns = ["powers", "albanese", "belmark", "inderbitzin", "pirate"];
  const staleVendors: string[] = [];

  for (const r of rows) {
    const from = (r.from_address || "").toLowerCase();
    for (const vendor of vendorPatterns) {
      if (from.includes(vendor) && !staleVendors.includes(vendor)) {
        staleVendors.push(vendor);
      }
    }
  }

  if (staleVendors.length > 0) {
    return {
      type: "stale_vendor_comms",
      severity: "warning",
      title: `${staleVendors.length} vendor thread(s) >7 days old`,
      detail: `Vendors with old unanswered threads: ${staleVendors.join(", ")}. Check if follow-up is needed.`,
      data: { vendors: staleVendors },
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

async function checkPendingApprovals(): Promise<Signal | null> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await sbQuery<Array<{ id: string }>>(
    `/rest/v1/approvals?status=eq.pending&created_at=lt.${encodeURIComponent(oneDayAgo)}&select=id&limit=20`,
  );
  if (!rows || rows.length === 0) return null;

  return {
    type: "stale_approvals",
    severity: rows.length > 5 ? "critical" : "warning",
    title: `${rows.length} approval(s) pending >24h`,
    detail: "These actions are waiting for human review and may be blocking operations.",
    data: { count: rows.length },
    timestamp: new Date().toISOString(),
  };
}

// ─── Main Scanner ───

const DETECTORS = [
  { name: "revenue_anomaly", fn: checkRevenueAnomaly },
  { name: "inventory_runway", fn: checkInventoryRunway },
  { name: "ai_budget", fn: checkAIBudget },
  { name: "stale_vendor_comms", fn: checkStaleVendorComms },
  { name: "stale_approvals", fn: checkPendingApprovals },
];

export async function scanForSignals(): Promise<SignalScanResult> {
  const signals: Signal[] = [];
  const scanned: string[] = [];
  const errors: string[] = [];

  const results = await Promise.allSettled(
    DETECTORS.map(async (d) => {
      const signal = await d.fn();
      scanned.push(d.name);
      if (signal) signals.push(signal);
    }),
  );

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      errors.push(`${DETECTORS[i].name}: ${(results[i] as PromiseRejectedResult).reason}`);
    }
  }

  return { signals, scanned, errors, timestamp: new Date().toISOString() };
}

export async function scanAndAlert(): Promise<SignalScanResult> {
  const result = await scanForSignals();

  if (result.signals.length === 0) return result;

  // Post signals to Slack
  const critical = result.signals.filter((s) => s.severity === "critical");
  const warnings = result.signals.filter((s) => s.severity === "warning");

  if (critical.length > 0) {
    const msg = [
      `🚨 *Abra Signal Alert — ${critical.length} critical signal(s)*`,
      "",
      ...critical.map((s) => `• *${s.title}*\n  ${s.detail}`),
    ].join("\n");
    void notifyAlert(msg);
  }

  if (warnings.length > 0) {
    const msg = [
      `⚠️ *Abra Signals — ${warnings.length} warning(s)*`,
      "",
      ...warnings.map((s) => `• *${s.title}*\n  ${s.detail}`),
    ].join("\n");
    void notifyDaily(msg);
  }

  return result;
}
