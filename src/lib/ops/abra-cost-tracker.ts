/**
 * Abra Cost Tracker — Logs every LLM call and tracks monthly spend
 *
 * All cost logging is best-effort (never blocks responses).
 * Monthly budget: $1,000 (configurable via ABRA_MONTHLY_BUDGET env var).
 */

import { readState, writeState } from "@/lib/ops/state";
import { notifyAlert, notifyDaily } from "@/lib/ops/notify";

const MONTHLY_BUDGET = Number(process.env.ABRA_MONTHLY_BUDGET) || 1000;
const BUDGET_FALLBACK_MODEL =
  process.env.ABRA_BUDGET_FALLBACK_MODEL || "claude-3-5-haiku-latest";
const GOVERNOR_STATE_KEY = "abra-model-governor" as const;

type BudgetAlertLevel = "none" | "info" | "warning" | "critical";

type GovernorState = {
  month: string;
  lastAlertLevel: BudgetAlertLevel;
  forceHaiku: boolean;
  updatedAt: string;
  spend: number;
  budget: number;
};

// Pricing per million tokens (as of March 2026)
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6-20260315": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbInsert(
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const env = getSupabaseEnv();
  if (!env) return;

  await fetch(`${env.baseUrl}${path}`, {
    method: "POST",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
}

function monthRange(targetMonth?: string): { startIso: string; endIso: string } {
  const [yearStr, monthStr] = (targetMonth || new Date().toISOString().slice(0, 7)).split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;

  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0));

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

async function fetchMonthlyCostRows(
  targetMonth?: string,
): Promise<Array<{ department: string | null; model: string; estimated_cost_usd: number }>> {
  const env = getSupabaseEnv();
  if (!env) return [];

  const { startIso, endIso } = monthRange(targetMonth);
  const path = `/rest/v1/abra_cost_log?select=department,model,estimated_cost_usd&created_at=gte.${encodeURIComponent(startIso)}&created_at=lt.${encodeURIComponent(endIso)}&limit=5000`;
  const res = await fetch(`${env.baseUrl}${path}`, {
    method: "GET",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cost row fetch failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const rows = (await res.json()) as Array<{
    department: string | null;
    model: string;
    estimated_cost_usd: number;
  }>;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Estimate cost in USD for a given model and token counts.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[model] || PRICING["claude-sonnet-4-6-20260315"];
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Log an AI cost entry (best-effort, never throws).
 */
export async function logAICost(params: {
  model: string;
  provider: "anthropic" | "openai";
  inputTokens: number;
  outputTokens: number;
  endpoint: string;
  department?: string;
}): Promise<void> {
  try {
    const cost = estimateCost(
      params.model,
      params.inputTokens,
      params.outputTokens,
    );

    await sbInsert("/rest/v1/abra_cost_log", {
      model: params.model,
      provider: params.provider,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      estimated_cost_usd: cost,
      endpoint: params.endpoint,
      department: params.department || null,
    });

    await checkBudgetAndAlert();
  } catch {
    // Best-effort — never block the response
  }
}

/**
 * Extract usage from a Claude API response payload.
 */
export function extractClaudeUsage(
  payload: Record<string, unknown>,
): { inputTokens: number; outputTokens: number } | null {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const inputTokens =
    typeof u.input_tokens === "number" ? u.input_tokens : 0;
  const outputTokens =
    typeof u.output_tokens === "number" ? u.output_tokens : 0;
  return { inputTokens, outputTokens };
}

/**
 * Get monthly spend summary.
 * Returns { total, budget, remaining, pctUsed, callCount }.
 */
export async function getMonthlySpend(
  targetMonth?: string,
): Promise<{
  total: number;
  budget: number;
  remaining: number;
  pctUsed: number;
  callCount: number;
  byProvider: Record<string, number>;
  byEndpoint: Record<string, number>;
}> {
  const env = getSupabaseEnv();
  if (!env) {
    return {
      total: 0,
      budget: MONTHLY_BUDGET,
      remaining: MONTHLY_BUDGET,
      pctUsed: 0,
      callCount: 0,
      byProvider: {},
      byEndpoint: {},
    };
  }

  try {
    const month =
      targetMonth || new Date().toISOString().slice(0, 7); // YYYY-MM

    const res = await fetch(
      `${env.baseUrl}/rest/v1/rpc/get_monthly_ai_spend`,
      {
        method: "POST",
        headers: {
          apikey: env.serviceKey,
          Authorization: `Bearer ${env.serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target_month: month }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) {
      throw new Error(`RPC failed: ${res.status}`);
    }

    const rows = (await res.json()) as Array<{
      total_cost: number;
      call_count: number;
      by_provider: Record<string, number>;
      by_endpoint: Record<string, number>;
    }>;

    const row = rows[0];
    if (!row) {
      return {
        total: 0,
        budget: MONTHLY_BUDGET,
        remaining: MONTHLY_BUDGET,
        pctUsed: 0,
        callCount: 0,
        byProvider: {},
        byEndpoint: {},
      };
    }

    const total = Number(row.total_cost) || 0;
    return {
      total: Math.round(total * 100) / 100,
      budget: MONTHLY_BUDGET,
      remaining: Math.round((MONTHLY_BUDGET - total) * 100) / 100,
      pctUsed: Math.round((total / MONTHLY_BUDGET) * 10000) / 100,
      callCount: Number(row.call_count) || 0,
      byProvider: row.by_provider || {},
      byEndpoint: row.by_endpoint || {},
    };
  } catch {
    return {
      total: 0,
      budget: MONTHLY_BUDGET,
      remaining: MONTHLY_BUDGET,
      pctUsed: 0,
      callCount: 0,
      byProvider: {},
      byEndpoint: {},
    };
  }
}

export async function getSpendByDepartment(
  targetMonth?: string,
): Promise<Record<string, number>> {
  try {
    const rows = await fetchMonthlyCostRows(targetMonth);
    const grouped: Record<string, number> = {};

    for (const row of rows) {
      const key = (row.department || "unassigned").trim() || "unassigned";
      grouped[key] = (grouped[key] || 0) + Number(row.estimated_cost_usd || 0);
    }

    return Object.fromEntries(
      Object.entries(grouped).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    );
  } catch {
    return {};
  }
}

export async function getSpendByModel(
  targetMonth?: string,
): Promise<Record<string, number>> {
  try {
    const rows = await fetchMonthlyCostRows(targetMonth);
    const grouped: Record<string, number> = {};

    for (const row of rows) {
      const key = (row.model || "unknown").trim() || "unknown";
      grouped[key] = (grouped[key] || 0) + Number(row.estimated_cost_usd || 0);
    }

    return Object.fromEntries(
      Object.entries(grouped).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    );
  } catch {
    return {};
  }
}

function alertLevelFromPct(pctUsed: number): BudgetAlertLevel {
  if (pctUsed >= 95) return "critical";
  if (pctUsed >= 80) return "warning";
  if (pctUsed >= 50) return "info";
  return "none";
}

function defaultGovernorState(month: string): GovernorState {
  return {
    month,
    lastAlertLevel: "none",
    forceHaiku: false,
    updatedAt: new Date().toISOString(),
    spend: 0,
    budget: MONTHLY_BUDGET,
  };
}

export async function getModelGovernorState(): Promise<GovernorState> {
  const month = new Date().toISOString().slice(0, 7);
  const fallback = defaultGovernorState(month);
  const state = await readState(GOVERNOR_STATE_KEY, fallback);
  if (!state || typeof state !== "object") return fallback;
  const row = state as Partial<GovernorState>;
  if (row.month !== month) return fallback;
  return {
    month: row.month || month,
    lastAlertLevel:
      row.lastAlertLevel === "info" ||
      row.lastAlertLevel === "warning" ||
      row.lastAlertLevel === "critical"
        ? row.lastAlertLevel
        : "none",
    forceHaiku: row.forceHaiku === true,
    updatedAt: row.updatedAt || new Date().toISOString(),
    spend: Number(row.spend || 0),
    budget: Number(row.budget || MONTHLY_BUDGET),
  };
}

export async function getPreferredClaudeModel(
  defaultModel: string,
): Promise<string> {
  const state = await getModelGovernorState();
  if (state.forceHaiku) return BUDGET_FALLBACK_MODEL;
  return defaultModel;
}

export async function checkBudgetAndAlert(): Promise<{
  level: BudgetAlertLevel;
  spend: number;
  budget: number;
  pctUsed: number;
  forceHaiku: boolean;
}> {
  const spend = await getMonthlySpend();
  const month = new Date().toISOString().slice(0, 7);
  const level = alertLevelFromPct(spend.pctUsed);
  const previous = await getModelGovernorState();

  const next: GovernorState = {
    month,
    lastAlertLevel: level,
    forceHaiku: level === "critical",
    updatedAt: new Date().toISOString(),
    spend: spend.total,
    budget: spend.budget,
  };

  const levelChanged = previous.lastAlertLevel !== level;

  if (levelChanged) {
    if (level === "info") {
      console.info(
        `[abra-cost] Budget at ${spend.pctUsed.toFixed(1)}% ($${spend.total.toFixed(2)} / $${spend.budget}).`,
      );
      void notifyDaily(
        `🟦 Abra AI budget at ${spend.pctUsed.toFixed(1)}% ($${spend.total.toFixed(2)} / $${spend.budget}).`,
      );
    }

    if (level === "warning") {
      void notifyAlert(
        `🟨 Abra AI spend warning: ${spend.pctUsed.toFixed(1)}% used ($${spend.total.toFixed(2)} / $${spend.budget}).`,
      );
    }

    if (level === "critical") {
      void notifyAlert(
        `🟥 Abra AI spend critical: ${spend.pctUsed.toFixed(1)}% used ($${spend.total.toFixed(2)} / $${spend.budget}). Auto-downgrading to ${BUDGET_FALLBACK_MODEL}.`,
        true,
      );
    }
  }

  if (level !== "critical" && previous.forceHaiku && spend.pctUsed < 90) {
    next.forceHaiku = false;
  }

  await writeState(GOVERNOR_STATE_KEY, next);

  return {
    level,
    spend: spend.total,
    budget: spend.budget,
    pctUsed: spend.pctUsed,
    forceHaiku: next.forceHaiku,
  };
}

/**
 * Check if we're approaching budget limits.
 * Returns true if we should alert or downgrade models.
 */
export async function isBudgetCritical(): Promise<{
  shouldAlert: boolean;
  shouldDowngrade: boolean;
  spend: number;
  budget: number;
}> {
  const { total } = await getMonthlySpend();
  return {
    shouldAlert: total >= MONTHLY_BUDGET * 0.8,
    shouldDowngrade: total >= MONTHLY_BUDGET * 0.95,
    spend: total,
    budget: MONTHLY_BUDGET,
  };
}
