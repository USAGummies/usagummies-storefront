/**
 * Agent Performance Tracking — B5 build.
 *
 * Tracks success/failure rates for all 94+ agents, identifies degraded agents,
 * and optionally auto-disables broken ones after consecutive failures.
 *
 * Storage: Supabase `agent_runs` table (primary), Vercel KV (fallback + disable state).
 */

import { readState, writeState } from "@/lib/ops/state";
import { ENGINE_REGISTRY } from "@/lib/ops/engine-schedule";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRunRecord = {
  engineId: string;
  agentKey: string;
  agentName: string;
  status: "success" | "failed" | "skipped" | "timeout";
  durationMs: number;
  timestamp: string;
  error?: string;
};

export type AgentHealthReport = {
  engineId: string;
  agentKey: string;
  agentName: string;
  last7Days: {
    runs: number;
    successes: number;
    failures: number;
    successRate: number;
    avgDurationMs: number;
  };
  lastRun: AgentRunRecord | null;
  health: "healthy" | "degraded" | "failing" | "inactive";
  consecutiveFailures: number;
  disabled: boolean;
};

// ---------------------------------------------------------------------------
// Supabase helpers (same pattern as error-tracker.ts)
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    const res = await fetch(`${env.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: init.signal || AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[agent-performance] Supabase ${init.method || "GET"} ${path} failed: ${res.status} ${body}`,
      );
      return null;
    }

    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  } catch (err) {
    console.error(`[agent-performance] Supabase fetch error:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// KV state keys for fallback storage and disable state
// ---------------------------------------------------------------------------

const RUNS_STATE_KEY = "agent-performance-runs" as const;
const DISABLED_STATE_KEY = "agent-performance-disabled" as const;

type DisabledAgentMap = Record<string, { reason: string; disabledAt: string }>;

function agentId(engineId: string, agentKey: string): string {
  return `${engineId}:${agentKey}`;
}

// ---------------------------------------------------------------------------
// recordAgentRun — store run result (Supabase primary, KV fallback)
// ---------------------------------------------------------------------------

export async function recordAgentRun(record: AgentRunRecord): Promise<void> {
  // Try Supabase first
  const sbResult = await sbFetch("/rest/v1/agent_runs", {
    method: "POST",
    headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
    body: JSON.stringify({
      engine_id: record.engineId,
      agent_key: record.agentKey,
      agent_name: record.agentName,
      status: record.status,
      duration_ms: record.durationMs,
      error_message: record.error || null,
      run_at: record.timestamp,
    }),
  });

  if (sbResult !== null) return; // Supabase write succeeded

  // Fallback: append to KV state array (keep last 5000 entries)
  console.warn("[agent-performance] Supabase unavailable — falling back to KV state");
  const existing = await readState(RUNS_STATE_KEY as Parameters<typeof readState>[0], [] as AgentRunRecord[]);
  const arr = Array.isArray(existing) ? existing : [];
  arr.push(record);
  // Keep last 5000 entries
  const trimmed = arr.slice(-5000);
  await writeState(RUNS_STATE_KEY as Parameters<typeof writeState>[0], trimmed);
}

// ---------------------------------------------------------------------------
// getAgentHealth — compute health report from recent runs
// ---------------------------------------------------------------------------

export async function getAgentHealth(
  engineId: string,
  agentKey: string,
): Promise<AgentHealthReport> {
  const agentName = resolveAgentName(engineId, agentKey);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Try Supabase
  const runs = await sbFetch<Array<{
    engine_id: string;
    agent_key: string;
    agent_name: string;
    status: string;
    duration_ms: number;
    error_message: string | null;
    run_at: string;
  }>>(
    `/rest/v1/agent_runs?engine_id=eq.${encodeURIComponent(engineId)}&agent_key=eq.${encodeURIComponent(agentKey)}&run_at=gte.${encodeURIComponent(sevenDaysAgo)}&order=run_at.desc&limit=200`,
    { method: "GET", headers: { Accept: "application/json" } },
  );

  let records: AgentRunRecord[];

  if (runs && runs.length > 0) {
    records = runs.map((r) => ({
      engineId: r.engine_id,
      agentKey: r.agent_key,
      agentName: r.agent_name || agentName,
      status: r.status as AgentRunRecord["status"],
      durationMs: r.duration_ms ?? 0,
      timestamp: r.run_at,
      error: r.error_message || undefined,
    }));
  } else {
    // Fallback: read from KV state
    const allRuns = await readState(
      RUNS_STATE_KEY as Parameters<typeof readState>[0],
      [] as AgentRunRecord[],
    );
    const arr = Array.isArray(allRuns) ? allRuns : [];
    records = arr.filter(
      (r) =>
        r.engineId === engineId &&
        r.agentKey === agentKey &&
        r.timestamp >= sevenDaysAgo,
    );
    records.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
  }

  const disabled = await isAgentDisabled(engineId, agentKey);

  return buildHealthReport(engineId, agentKey, agentName, records, disabled);
}

// ---------------------------------------------------------------------------
// getAllAgentHealth — health for all registered agents
// ---------------------------------------------------------------------------

export async function getAllAgentHealth(): Promise<AgentHealthReport[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Try to fetch all runs from Supabase in one query
  const allSbRuns = await sbFetch<Array<{
    engine_id: string;
    agent_key: string;
    agent_name: string;
    status: string;
    duration_ms: number;
    error_message: string | null;
    run_at: string;
  }>>(
    `/rest/v1/agent_runs?run_at=gte.${encodeURIComponent(sevenDaysAgo)}&order=run_at.desc&limit=5000`,
    { method: "GET", headers: { Accept: "application/json" } },
  );

  // Build a map of runs by agent
  const runsMap = new Map<string, AgentRunRecord[]>();

  if (allSbRuns && allSbRuns.length > 0) {
    for (const r of allSbRuns) {
      const key = agentId(r.engine_id, r.agent_key);
      if (!runsMap.has(key)) runsMap.set(key, []);
      runsMap.get(key)!.push({
        engineId: r.engine_id,
        agentKey: r.agent_key,
        agentName: r.agent_name || "",
        status: r.status as AgentRunRecord["status"],
        durationMs: r.duration_ms ?? 0,
        timestamp: r.run_at,
        error: r.error_message || undefined,
      });
    }
  } else {
    // Fallback: KV state
    const allRuns = await readState(
      RUNS_STATE_KEY as Parameters<typeof readState>[0],
      [] as AgentRunRecord[],
    );
    const arr = Array.isArray(allRuns) ? allRuns : [];
    for (const r of arr) {
      if (r.timestamp < sevenDaysAgo) continue;
      const key = agentId(r.engineId, r.agentKey);
      if (!runsMap.has(key)) runsMap.set(key, []);
      runsMap.get(key)!.push(r);
    }
  }

  // Load disabled state once
  const disabledMap = await readState(
    DISABLED_STATE_KEY as Parameters<typeof readState>[0],
    {} as DisabledAgentMap,
  );
  const safeDisabledMap: DisabledAgentMap =
    disabledMap && typeof disabledMap === "object" && !Array.isArray(disabledMap)
      ? (disabledMap as DisabledAgentMap)
      : {};

  const reports: AgentHealthReport[] = [];

  for (const engine of ENGINE_REGISTRY) {
    for (const agent of engine.agents) {
      const key = agentId(engine.id, agent.key);
      const records = runsMap.get(key) || [];
      records.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
      const disabled = key in safeDisabledMap;
      reports.push(
        buildHealthReport(engine.id, agent.key, agent.name, records, disabled),
      );
    }
  }

  return reports;
}

// ---------------------------------------------------------------------------
// getFailingAgents — agents with >3 consecutive failures or <50% success rate
// ---------------------------------------------------------------------------

export async function getFailingAgents(): Promise<AgentHealthReport[]> {
  const all = await getAllAgentHealth();
  return all.filter(
    (r) =>
      r.health === "failing" ||
      r.health === "degraded" ||
      r.consecutiveFailures > 3 ||
      (r.last7Days.runs >= 3 && r.last7Days.successRate < 50),
  );
}

// ---------------------------------------------------------------------------
// shouldAutoDisable — true if 5+ consecutive failures
// ---------------------------------------------------------------------------

export async function shouldAutoDisable(
  engineId: string,
  agentKey: string,
): Promise<boolean> {
  const report = await getAgentHealth(engineId, agentKey);
  return report.consecutiveFailures >= 5;
}

// ---------------------------------------------------------------------------
// disableAgent / isAgentDisabled — KV state based
// ---------------------------------------------------------------------------

export async function disableAgent(
  engineId: string,
  agentKey: string,
  reason: string,
): Promise<void> {
  const disabledMap = await readState(
    DISABLED_STATE_KEY as Parameters<typeof readState>[0],
    {} as DisabledAgentMap,
  );
  const safeMap: DisabledAgentMap =
    disabledMap && typeof disabledMap === "object" && !Array.isArray(disabledMap)
      ? (disabledMap as DisabledAgentMap)
      : {};

  safeMap[agentId(engineId, agentKey)] = {
    reason,
    disabledAt: new Date().toISOString(),
  };

  await writeState(DISABLED_STATE_KEY as Parameters<typeof writeState>[0], safeMap);
  console.warn(
    `[agent-performance] Disabled agent ${engineId}/${agentKey}: ${reason}`,
  );
}

export async function isAgentDisabled(
  engineId: string,
  agentKey: string,
): Promise<boolean> {
  const disabledMap = await readState(
    DISABLED_STATE_KEY as Parameters<typeof readState>[0],
    {} as DisabledAgentMap,
  );
  const safeMap: DisabledAgentMap =
    disabledMap && typeof disabledMap === "object" && !Array.isArray(disabledMap)
      ? (disabledMap as DisabledAgentMap)
      : {};
  return agentId(engineId, agentKey) in safeMap;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveAgentName(engineId: string, agentKey: string): string {
  for (const engine of ENGINE_REGISTRY) {
    if (engine.id === engineId) {
      const agent = engine.agents.find((a: any) => a.key === agentKey);
      if (agent) return agent.name;
    }
  }
  return `${engineId}/${agentKey}`;
}

function buildHealthReport(
  engineId: string,
  agentKey: string,
  agentName: string,
  records: AgentRunRecord[],
  disabled: boolean,
): AgentHealthReport {
  const successes = records.filter((r) => r.status === "success").length;
  const failures = records.filter(
    (r) => r.status === "failed" || r.status === "timeout",
  ).length;
  const totalDuration = records.reduce((sum, r) => sum + (r.durationMs || 0), 0);

  // Count consecutive failures from most recent run backwards
  let consecutiveFailures = 0;
  for (const r of records) {
    if (r.status === "failed" || r.status === "timeout") {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  const runs = records.length;
  const successRate = runs > 0 ? Math.round((successes / runs) * 100) : 0;
  const avgDurationMs = runs > 0 ? Math.round(totalDuration / runs) : 0;

  // Determine health status
  let health: AgentHealthReport["health"];
  if (runs === 0) {
    health = "inactive";
  } else if (consecutiveFailures >= 5 || (runs >= 3 && successRate < 30)) {
    health = "failing";
  } else if (
    consecutiveFailures >= 3 ||
    (runs >= 3 && successRate < 50)
  ) {
    health = "degraded";
  } else {
    health = "healthy";
  }

  return {
    engineId,
    agentKey,
    agentName,
    last7Days: {
      runs,
      successes,
      failures,
      successRate,
      avgDurationMs,
    },
    lastRun: records.length > 0 ? records[0] : null,
    health,
    consecutiveFailures,
    disabled,
  };
}
