/**
 * Run-history reader — pure function. Filters audit-log entries
 * down to a single agent and produces a per-run timeline view.
 *
 * Closes Phase 2 build-sequence item: "/ops/agents dashboard —
 * consolidated run history per agent". The /ops/agents/status
 * strip already shows the LAST run; this drills into the last N
 * runs for a single agent.
 *
 * "Run" granularity = one `runId`. A single run can produce multiple
 * audit entries (the orchestrator + each Class A/B fire). We collapse
 * by `runId` so the timeline shows one row per agent invocation, with
 * the entry count + worst-result rolled up.
 *
 * Pure function. No I/O. Caller (the route handler) supplies the
 * audit-store window.
 */

import type { AuditLogEntry } from "../control-plane/types";

export interface RunHistoryItem {
  runId: string;
  /** Earliest createdAt across the run's entries. */
  startedAt: string;
  /** Latest createdAt across the run's entries. */
  endedAt: string;
  /** Wall-clock duration in seconds (endedAt - startedAt). */
  durationSeconds: number;
  /** Number of audit entries the run produced. */
  entryCount: number;
  /**
   * Worst-result rollup. Order: error > stood-down > skipped > ok.
   * If any entry errored, the run is "error". Pure-ok runs are "ok".
   */
  worstResult: AuditLogEntry["result"];
  /** Distinct action slugs the run touched, ordered by first occurrence. */
  actions: string[];
  /** First entry's action — useful as a one-line headline. */
  primaryAction: string;
  /**
   * One-line summary lifted from `entry.after.summary` if present, else
   * `entry.after.nextHumanAction`, else null. Searched across all entries
   * in the run, first match wins.
   */
  summary: string | null;
  /** Concatenated error messages (deduped) across the run. */
  errorMessages: string[];
  /**
   * Source citations from the FIRST entry in the run — typically the
   * orchestrator envelope which carries the most representative cite set.
   */
  primaryCitations: AuditLogEntry["sourceCitations"];
}

export interface AgentRunHistory {
  agentId: string;
  /** Raw entry count across all runs in the window (pre-collapse). */
  totalEntries: number;
  /** Distinct run count (post-collapse). */
  totalRuns: number;
  /** Items, newest-run-first. */
  items: RunHistoryItem[];
  /**
   * Source-window descriptor — caller fills based on what they queried.
   * Stored on the result so the UI can render "showing last 50 runs from
   * the last 1000 audit entries" honestly.
   */
  windowDescription: string;
}

const RESULT_RANK: Record<AuditLogEntry["result"], number> = {
  ok: 0,
  skipped: 1,
  "stood-down": 2,
  error: 3,
};

function pickWorse(
  a: AuditLogEntry["result"],
  b: AuditLogEntry["result"],
): AuditLogEntry["result"] {
  return RESULT_RANK[a] >= RESULT_RANK[b] ? a : b;
}

function extractSummary(entry: AuditLogEntry): string | null {
  const after = entry.after;
  if (!after || typeof after !== "object") return null;
  const summary = (after as { summary?: unknown }).summary;
  if (typeof summary === "string") return summary;
  if (summary && typeof summary === "object") {
    const nested = (summary as { summary?: unknown }).summary;
    if (typeof nested === "string") return nested;
  }
  const nha = (after as { nextHumanAction?: unknown }).nextHumanAction;
  return typeof nha === "string" ? nha : null;
}

/**
 * Collapse audit entries → run-collapsed timeline for a single agent.
 *
 * @param entries  Audit entries from auditStore.recent() (or any window).
 *                 No order assumption — function sorts.
 * @param agentId  actorId to filter by.
 * @param opts.limit  Max number of runs to return (default 50, cap 500).
 * @param opts.windowDescription  Human-readable text describing the source
 *                 window. Defaults to "from supplied audit entries".
 */
export function buildAgentRunHistory(
  entries: readonly AuditLogEntry[],
  agentId: string,
  opts: {
    limit?: number;
    windowDescription?: string;
  } = {},
): AgentRunHistory {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  const windowDescription =
    opts.windowDescription ?? "from supplied audit entries";

  const matching = entries.filter(
    (e) => e.actorType === "agent" && e.actorId === agentId,
  );

  // Group by runId. Insertion order = first-seen order; we'll re-sort at
  // the end by startedAt desc.
  const byRunId = new Map<string, AuditLogEntry[]>();
  for (const entry of matching) {
    const list = byRunId.get(entry.runId);
    if (list) list.push(entry);
    else byRunId.set(entry.runId, [entry]);
  }

  const items: RunHistoryItem[] = [];
  for (const [runId, runEntries] of byRunId.entries()) {
    // Sort entries by createdAt asc so primaryAction = first entry.
    const sorted = [...runEntries].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
    );
    const startedAt = sorted[0].createdAt;
    const endedAt = sorted[sorted.length - 1].createdAt;
    const durationMs =
      new Date(endedAt).getTime() - new Date(startedAt).getTime();
    const durationSeconds = Math.max(
      0,
      Math.round(durationMs / 1000),
    );

    const actions: string[] = [];
    const seen = new Set<string>();
    for (const e of sorted) {
      if (!seen.has(e.action)) {
        actions.push(e.action);
        seen.add(e.action);
      }
    }

    let worstResult: AuditLogEntry["result"] = "ok";
    for (const e of sorted) worstResult = pickWorse(worstResult, e.result);

    let summary: string | null = null;
    for (const e of sorted) {
      const s = extractSummary(e);
      if (s) {
        summary = s;
        break;
      }
    }

    const errorMessages: string[] = [];
    const seenErr = new Set<string>();
    for (const e of sorted) {
      if (e.error?.message && !seenErr.has(e.error.message)) {
        errorMessages.push(e.error.message);
        seenErr.add(e.error.message);
      }
    }

    items.push({
      runId,
      startedAt,
      endedAt,
      durationSeconds,
      entryCount: sorted.length,
      worstResult,
      actions,
      primaryAction: sorted[0].action,
      summary,
      errorMessages,
      primaryCitations: sorted[0].sourceCitations ?? [],
    });
  }

  // Newest-run-first.
  items.sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
  );

  return {
    agentId,
    totalEntries: matching.length,
    totalRuns: items.length,
    items: items.slice(0, limit),
    windowDescription,
  };
}
