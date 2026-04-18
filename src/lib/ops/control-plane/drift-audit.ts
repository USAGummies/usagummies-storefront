/**
 * Weekly drift audit runner.
 *
 * Canonical spec: /contracts/governance.md §5 + blueprint §15.4 W3b.
 * Sunday 8 PM PT: sample N agent outputs from the last 7d, score each,
 * count violations + corrections per agent, auto-pause anyone with ≥2
 * violations in the window, post the scorecard to #ops-audit + archive
 * to Open Brain (archive is a separate concern plugged in by caller).
 *
 * Scoring today is "needs-review" per sample — a human reviewer tags
 * each as correct/partial/wrong/hallucinated. Day-one we surface the
 * sample + enforce violation-count auto-pause, which is a strict
 * improvement over the self-graded Sunday standup pattern that quietly
 * claimed "8/8 PASS" while violations were ongoing.
 *
 * Per-slug automated validators (a validator(slug, entry) → assessment)
 * will land incrementally; declare them in validators.ts when added.
 * The runner already accepts an optional `validate` callback so the
 * path is open.
 */

import { randomUUID } from "node:crypto";

import type {
  AuditLogEntry,
  DivisionId,
  PolicyViolation,
} from "./types";
import type { AuditStore, AuditSlackSurface } from "./audit";
import type { PauseSink } from "./enforcement";
import { buildAuditEntry } from "./audit";

// ---- Types ----

export type DriftAssessment =
  | "needs-review"
  | "correct"
  | "partial"
  | "wrong"
  | "hallucinated";

export interface DriftAuditSample {
  entryId: string;
  runId: string;
  agent: string;
  division: string;
  action: string;
  entityType: string;
  entityId?: string;
  createdAt: string;
  assessment: DriftAssessment;
  /** Short reviewer note. Populated by validators or by a human afterward. */
  note?: string;
}

export interface DriftAuditScorecard {
  id: string;
  generatedAt: string;
  windowStart: string; // ISO
  windowEnd: string; // ISO
  /** How many entries were considered before sampling. */
  totalEligibleEntries: number;
  /** N requested; actual sample size is min(N, totalEligibleEntries). */
  sampleSize: number;
  samples: DriftAuditSample[];
  /** Violations recorded in the window, grouped by agentId. */
  violationsByAgent: Record<string, number>;
  totalViolations: number;
  /** Number of human corrections in the window (source: corrections store; caller-supplied). */
  correctionsCount: number;
  /**
   * Agents with ≥2 violations → auto-paused per /contracts/governance.md §5.
   * Populated whether or not a PauseSink is wired; the `enforcement` block
   * below records whether the pause was actually persisted.
   */
  agentsAutoPaused: string[];
  /**
   * Agents whose auto-pause persistence failed (sink threw). The audit
   * still succeeds — the run does not block on partial enforcement —
   * but failed pauses are called out explicitly so they can be retried.
   */
  agentsPauseErrored: Array<{ agentId: string; error: string }>;
  /**
   * Enforcement telemetry. Captured per-run so downstream consumers
   * (Notion archive, dashboards, incident review) can tell when the audit
   * ran in degraded mode.
   */
  enforcement: {
    /**
     * `enforced` — PauseSink accepted every pause call for this run.
     * `partial` — some agents were paused, some sink calls failed.
     * `skipped` — no PauseSink was provided; scorecard is advisory only.
     * `not-needed` — 0 agents met the threshold this run.
     */
    mode: "enforced" | "partial" | "skipped" | "not-needed";
    pauseSinkPresent: boolean;
    pausesApplied: number;
    pausesFailed: number;
    notes: string[];
  };
}

export type Validator = (entry: AuditLogEntry) => Promise<{
  assessment: DriftAssessment;
  note?: string;
} | null>;

export interface DriftAuditInput {
  store: AuditStore;
  surface?: AuditSlackSurface | null;
  /**
   * Where auto-pause state is persisted. When omitted, the scorecard
   * reports enforcement.mode = "skipped" so callers / archive consumers
   * know the audit is advisory for this run. Provide a real PauseSink in
   * production; provide an in-process sink in tests.
   */
  pauseSink?: PauseSink | null;
  /** Default 10. */
  sampleSize?: number;
  /** Default 7. */
  windowDays?: number;
  now?: Date;
  /**
   * Violations recorded in the window. Caller fetches from wherever
   * violations live (ViolationStore, Open Brain, etc.). Empty array if
   * the violation store is not yet populated.
   */
  violations?: PolicyViolation[];
  /** Corrections count in window. Default 0 if not supplied. */
  correctionsCount?: number;
  /** Optional per-entry automated validator. Returning null leaves the sample "needs-review". */
  validate?: Validator;
  /** Pool size to draw the sample from. Default sampleSize * 20. */
  candidatePoolSize?: number;
  /** Randomness injection for tests. */
  rng?: () => number;
  /**
   * Division fallback for agents that do not appear in this run's audit
   * entries (e.g. they violated but produced no writes). Defaults to
   * "executive-control" so the PausedAgentRecord still gets a valid
   * DivisionId. Callers should supply a lookup when they can resolve it.
   */
  resolveDivision?: (agentId: string) => DivisionId | undefined;
}

// ---- Runner ----

const DEFAULT_SAMPLE_SIZE = 10;
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_POOL_MULTIPLIER = 20;
const AUTO_PAUSE_VIOLATION_THRESHOLD = 2;

export async function runDriftAudit(input: DriftAuditInput): Promise<DriftAuditScorecard> {
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const sampleSize = Math.max(0, input.sampleSize ?? DEFAULT_SAMPLE_SIZE);
  const pool = Math.max(sampleSize, input.candidatePoolSize ?? sampleSize * DEFAULT_POOL_MULTIPLIER);
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
  const rng = input.rng ?? Math.random;

  // Pull recent agent-authored entries within the window.
  const recent = await input.store.recent(pool);
  const eligible = recent.filter(
    (e) =>
      e.actorType === "agent" &&
      new Date(e.createdAt).getTime() >= windowStart.getTime(),
  );

  const samples = await composeSamples(
    eligible,
    Math.min(sampleSize, eligible.length),
    input.validate,
    rng,
  );

  const violations = input.violations ?? [];
  const inWindowViolations = violations.filter((v) => {
    const t = new Date(v.detectedAt).getTime();
    return t >= windowStart.getTime() && t <= windowEnd.getTime();
  });

  const violationsByAgent = countByAgent(inWindowViolations);
  const agentsAutoPaused = Object.entries(violationsByAgent)
    .filter(([, count]) => count >= AUTO_PAUSE_VIOLATION_THRESHOLD)
    .map(([agentId]) => agentId)
    .sort();

  const scorecardId = randomUUID();
  const agentsPauseErrored: DriftAuditScorecard["agentsPauseErrored"] = [];

  // ---- Enforce auto-pause ----
  //
  // For each agent over threshold, persist a PausedAgentRecord via the
  // sink. Failures are captured per-agent; the run continues so a
  // single sink hiccup does not collapse the whole audit. Every pause
  // action (success or failure) writes an audit entry under the
  // synthetic actor "drift-audit" so the enforcement trail is queryable.
  let pausesApplied = 0;
  let pausesFailed = 0;
  const enforcementNotes: string[] = [];

  if (agentsAutoPaused.length === 0) {
    enforcementNotes.push("0 agents met the auto-pause threshold this run.");
  }

  if (input.pauseSink && agentsAutoPaused.length > 0) {
    for (const agentId of agentsAutoPaused) {
      const division = resolveAgentDivision(agentId, eligible, input.resolveDivision);
      const violationsCount = violationsByAgent[agentId] ?? 0;
      const record = {
        agentId,
        division,
        reason: `Auto-pause: ${violationsCount} violations in ${windowDays}-day window`,
        violationsInWindow: violationsCount,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        scorecardId,
        pausedAt: now.toISOString(),
      };
      try {
        await input.pauseSink.pauseAgent(record);
        pausesApplied++;
        await emitAuditEntry(input.store, {
          id: scorecardId,
          division,
          action: "drift-audit.agent-paused",
          entityType: "agent",
          entityId: agentId,
          after: record,
          result: "ok",
        });
      } catch (err) {
        pausesFailed++;
        const message = err instanceof Error ? err.message : String(err);
        agentsPauseErrored.push({ agentId, error: message });
        await emitAuditEntry(input.store, {
          id: scorecardId,
          division,
          action: "drift-audit.agent-pause-failed",
          entityType: "agent",
          entityId: agentId,
          after: { ...record, error: message },
          result: "error",
          error: { message },
        });
      }
    }
  } else if (!input.pauseSink && agentsAutoPaused.length > 0) {
    enforcementNotes.push(
      `${agentsAutoPaused.length} agent(s) met the auto-pause threshold but no PauseSink was provided. Pause state NOT persisted — scorecard is advisory only for this run.`,
    );
  }

  let mode: DriftAuditScorecard["enforcement"]["mode"];
  if (agentsAutoPaused.length === 0) {
    mode = "not-needed";
  } else if (!input.pauseSink) {
    mode = "skipped";
  } else if (pausesFailed === 0) {
    mode = "enforced";
  } else {
    mode = "partial";
  }

  const scorecard: DriftAuditScorecard = {
    id: scorecardId,
    generatedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totalEligibleEntries: eligible.length,
    sampleSize: samples.length,
    samples,
    violationsByAgent,
    totalViolations: inWindowViolations.length,
    correctionsCount: input.correctionsCount ?? 0,
    agentsAutoPaused,
    agentsPauseErrored,
    enforcement: {
      mode,
      pauseSinkPresent: !!input.pauseSink,
      pausesApplied,
      pausesFailed,
      notes: enforcementNotes,
    },
  };

  // Best-effort mirror to #ops-audit. Scorecard is the canonical record;
  // callers typically also archive it to Notion/Open Brain out-of-band.
  if (input.surface) {
    const summary = renderScorecardSummary(scorecard);
    await input.surface
      .mirror({
        id: scorecardId,
        runId: scorecardId,
        division: "executive-control",
        actorType: "agent",
        actorId: "drift-audit",
        action: "drift-audit.scorecard",
        entityType: "scorecard",
        entityId: scorecardId,
        before: undefined,
        after: summary,
        result: "ok",
        sourceCitations: [{ system: "audit-log" }],
        confidence: 1.0,
        createdAt: scorecard.generatedAt,
      })
      .catch(() => void 0);
  }

  return scorecard;
}

/**
 * Write a drift-audit audit entry via buildAuditEntry, using a synthetic
 * RunContext that marks the actor as "drift-audit". Mirror failure is
 * swallowed so one bad append can't crash the enforcement loop.
 */
async function emitAuditEntry(
  store: AuditStore,
  params: {
    id: string;
    division: DivisionId;
    action: string;
    entityType: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    result: "ok" | "error" | "skipped" | "stood-down";
    error?: { message: string; code?: string };
  },
): Promise<void> {
  try {
    const entry = buildAuditEntry(
      {
        runId: params.id,
        agentId: "drift-audit",
        division: params.division,
        startedAt: new Date().toISOString(),
        source: "scheduled",
      },
      {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        before: params.before,
        after: params.after,
        result: params.result,
        error: params.error,
        sourceCitations: [{ system: "drift-audit" }],
      },
    );
    await store.append(entry);
  } catch {
    // Best effort. The scorecard itself captures the enforcement outcome.
  }
}

function resolveAgentDivision(
  agentId: string,
  sampledEntries: AuditLogEntry[],
  resolver: ((id: string) => DivisionId | undefined) | undefined,
): DivisionId {
  const resolved = resolver?.(agentId);
  if (resolved) return resolved;
  const fromEntry = sampledEntries.find((e) => e.actorId === agentId)?.division;
  if (fromEntry) return fromEntry;
  // Fallback: governance lives under executive-control, so attribute the
  // pause there rather than pick an incorrect division.
  return "executive-control";
}

// ---- Internals ----

async function composeSamples(
  eligible: AuditLogEntry[],
  n: number,
  validate: Validator | undefined,
  rng: () => number,
): Promise<DriftAuditSample[]> {
  if (n === 0 || eligible.length === 0) return [];
  const picks = sampleWithoutReplacement(eligible, n, rng);
  const samples: DriftAuditSample[] = [];
  for (const entry of picks) {
    let assessment: DriftAssessment = "needs-review";
    let note: string | undefined;
    if (validate) {
      try {
        const v = await validate(entry);
        if (v) {
          assessment = v.assessment;
          note = v.note;
        }
      } catch {
        // Validator failure leaves the sample in "needs-review" — safer than a wrong score.
      }
    }
    samples.push({
      entryId: entry.id,
      runId: entry.runId,
      agent: entry.actorId,
      division: entry.division,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      createdAt: entry.createdAt,
      assessment,
      note,
    });
  }
  return samples;
}

function sampleWithoutReplacement<T>(arr: readonly T[], n: number, rng: () => number): T[] {
  const pool = arr.slice();
  const out: T[] = [];
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) {
    const idx = Math.floor(rng() * pool.length);
    const safeIdx = idx >= pool.length ? pool.length - 1 : idx;
    out.push(pool[safeIdx]);
    pool.splice(safeIdx, 1);
  }
  return out;
}

function countByAgent(violations: PolicyViolation[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of violations) {
    out[v.agentId] = (out[v.agentId] ?? 0) + 1;
  }
  return out;
}

function renderScorecardSummary(sc: DriftAuditScorecard): string {
  const paused = sc.agentsAutoPaused.length
    ? sc.agentsAutoPaused.join(",")
    : "none";
  const violationsSummary = Object.entries(sc.violationsByAgent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([agent, count]) => `${agent}=${count}`)
    .join(",") || "none";
  const enforcementSummary =
    `${sc.enforcement.mode}` +
    (sc.enforcement.pausesApplied > 0 ? ` (applied ${sc.enforcement.pausesApplied})` : "") +
    (sc.enforcement.pausesFailed > 0 ? ` (failed ${sc.enforcement.pausesFailed})` : "");
  return [
    `samples=${sc.sampleSize}/${sc.totalEligibleEntries}`,
    `window=${sc.windowStart}..${sc.windowEnd}`,
    `violations=${sc.totalViolations}`,
    `corrections=${sc.correctionsCount}`,
    `by_agent=${violationsSummary}`,
    `auto_paused=${paused}`,
    `enforcement=${enforcementSummary}`,
  ].join(" | ");
}
