/**
 * GET /api/ops/agents/status
 *
 * Per-agent health strip for the `/ops/agents/status` UI + any CLI
 * that wants "how are my agents doing right now?" in one call.
 *
 * For every known agent (static manifest below):
 *   - Reads the last N audit entries via `auditStore().recent()`
 *   - Filters to entries whose `actorId` matches the agent
 *   - Reports: lastRunAt, result (ok/error/skipped/stood-down),
 *     runCount in 24h, errorCount in 24h, lastAction, staleness
 *
 * The manifest is intentionally small + hand-curated (vs reading
 * `/contracts/agents/*.md`) so the status strip doesn't depend on
 * contract file parsing. Add new agents here as they graduate.
 *
 * Auth: session OR bearer CRON_SECRET (matches preflight pattern).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { auditStore } from "@/lib/ops/control-plane/stores";
import type { AuditLogEntry } from "@/lib/ops/control-plane/types";
import { AGENT_MANIFEST } from "@/lib/ops/agents-runs/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AgentStatus {
  id: string;
  name: string;
  contract: string;
  runtimePath: string;
  cadence: string;
  channel: string;
  notes?: string;
  lastRunAt: string | null;
  lastResult: AuditLogEntry["result"] | null;
  lastAction: string | null;
  lastSummary: string | null;
  lastError: string | null;
  runsLast24h: number;
  errorsLast24h: number;
  staleness: "green" | "yellow" | "red" | "unknown";
  stalenessReason: string;
}

function assessStaleness(
  lastRunAt: string | null,
  cadence: string,
): { state: "green" | "yellow" | "red" | "unknown"; reason: string } {
  if (!lastRunAt) {
    return {
      state: "unknown",
      reason: "no recent runs recorded in audit log",
    };
  }
  const ageMs = Date.now() - new Date(lastRunAt).getTime();
  const ageH = ageMs / 3_600_000;
  // Cadence-driven thresholds. Weekday = 24h window, Weekly = 7 days.
  const cadenceLower = cadence.toLowerCase();
  const isDaily =
    cadenceLower.includes("weekday") || cadenceLower.includes("daily");
  const isThursday = cadenceLower.includes("thursday");
  const isWeekly = cadenceLower.includes("monday") && cadenceLower.includes("pt");
  const isEvent = cadenceLower.includes("event");

  let greenCap = 26; // hours
  let yellowCap = 48;
  if (isWeekly) {
    greenCap = 24 * 7 + 2;
    yellowCap = 24 * 9;
  } else if (isThursday) {
    greenCap = 24 * 7 + 2;
    yellowCap = 24 * 9;
  } else if (isEvent) {
    // Event-driven agents don't go stale by time. Report unknown when
    // no runs have happened; otherwise always green.
    return {
      state: "green",
      reason: `event-driven — last run ${Math.round(ageH)}h ago`,
    };
  } else if (!isDaily) {
    greenCap = 72;
    yellowCap = 168;
  }

  if (ageH <= greenCap) {
    return { state: "green", reason: `${Math.round(ageH)}h since last run` };
  }
  if (ageH <= yellowCap) {
    return {
      state: "yellow",
      reason: `${Math.round(ageH)}h since last run (expected ≤ ${greenCap}h)`,
    };
  }
  return {
    state: "red",
    reason: `${Math.round(ageH)}h since last run (expected ≤ ${greenCap}h)`,
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const degraded: string[] = [];
  let recent: AuditLogEntry[] = [];
  try {
    recent = await auditStore().recent(1000);
  } catch (err) {
    degraded.push(
      `audit-store: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const now = Date.now();
  const windowStart = now - 24 * 3600 * 1000;

  const statuses: AgentStatus[] = AGENT_MANIFEST.map((m) => {
    const agentEntries = recent.filter((e) => e.actorId === m.id);
    const lastEntry = agentEntries[0] ?? null;
    const last24h = agentEntries.filter(
      (e) => new Date(e.createdAt).getTime() >= windowStart,
    );
    const errors24h = last24h.filter((e) => e.result === "error").length;
    const lastRunAt = lastEntry?.createdAt ?? null;
    const st = assessStaleness(lastRunAt, m.cadence);

    return {
      id: m.id,
      name: m.name,
      contract: m.contract,
      runtimePath: m.runtimePath,
      cadence: m.cadence,
      channel: m.channel,
      notes: m.notes,
      lastRunAt,
      lastResult: lastEntry?.result ?? null,
      lastAction: lastEntry?.action ?? null,
      lastSummary: extractAuditSummary(lastEntry),
      lastError: lastEntry?.error?.message ?? null,
      runsLast24h: last24h.length,
      errorsLast24h: errors24h,
      staleness: st.state,
      stalenessReason: st.reason,
    };
  });

  // Rollup counters so the UI can show the green/yellow/red summary.
  const summary = statuses.reduce(
    (acc, s) => {
      acc[s.staleness] = (acc[s.staleness] ?? 0) + 1;
      return acc;
    },
    { green: 0, yellow: 0, red: 0, unknown: 0 } as Record<string, number>,
  );

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    agents: statuses,
    degraded,
  });
}

function extractAuditSummary(entry: AuditLogEntry | null): string | null {
  if (!entry) return null;
  const after = entry.after;
  if (!after || typeof after !== "object") return null;
  const summary = (after as { summary?: unknown }).summary;
  if (typeof summary === "string") return summary;
  if (summary && typeof summary === "object") {
    const nested = (summary as { summary?: unknown }).summary;
    if (typeof nested === "string") return nested;
  }
  const nextHumanAction = (after as { nextHumanAction?: unknown }).nextHumanAction;
  return typeof nextHumanAction === "string" ? nextHumanAction : null;
}
