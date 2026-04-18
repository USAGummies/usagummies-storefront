/**
 * Control-plane enforcement primitives:
 *   - PauseSink — persistent record of auto-paused agents
 *   - ViolationStore — append + window-query PolicyViolation entries
 *   - CorrectionStore — append + window-count human CorrectionEvent entries
 *
 * These three stores are storage-agnostic; adapters (in-memory + KV) live
 * in stores/ and are selected by the factory at stores/index.ts.
 *
 * Why they exist now:
 *   The weekly drift audit (drift-audit.ts) computed `agentsAutoPaused`
 *   but had no way to enforce the pause — no state was persisted anywhere
 *   queryable. The agent runtime could not ask "am I paused?" because
 *   nothing stored the answer. And the route hardcoded `violations: []`
 *   / `correctionsCount: 0`, so live runs could never trigger a pause in
 *   the first place.
 *
 * Canonical spec: /contracts/governance.md §5 (weekly drift audit) + §6
 * (correction protocol).
 */

import type { DivisionId, HumanOwner, PolicyViolation } from "./types";

// ---- PauseSink ---------------------------------------------------------

export interface PausedAgentRecord {
  agentId: string;
  division: DivisionId;
  reason: string;
  violationsInWindow: number;
  windowStart: string; // ISO
  windowEnd: string; // ISO
  scorecardId: string;
  pausedAt: string; // ISO
}

export interface PauseSink {
  /** Record a pause. Overwrites any existing pause for the same agentId. */
  pauseAgent(record: PausedAgentRecord): Promise<void>;
  /** Fast path for the runtime: `if (await pauseSink.isPaused(id)) return;` */
  isPaused(agentId: string): Promise<boolean>;
  /** Enumerate currently-paused agents (for dashboards, incident review). */
  listPaused(): Promise<PausedAgentRecord[]>;
  /**
   * Clear a pause. Blueprint §6.2: requires explicit Ben sign-off. The
   * sink does not enforce that — the caller does. `reason` is logged so
   * the unpause event is attributable.
   */
  unpauseAgent(agentId: string, reason: string): Promise<void>;
}

// ---- ViolationStore ----------------------------------------------------

export interface ViolationStore {
  append(v: PolicyViolation): Promise<void>;
  /** Entries with detectedAt in [sinceISO, untilISO]. */
  listInWindow(sinceISO: string, untilISO: string): Promise<PolicyViolation[]>;
  /**
   * True iff *any* violation was ever recorded. Used by the drift-audit
   * route to detect "store never populated" state so it can degrade the
   * response honestly instead of silently claiming a clean audit.
   */
  hasAnyEverRecorded(): Promise<boolean>;
}

// ---- CorrectionStore ---------------------------------------------------

export interface CorrectionEvent {
  id: string;
  at: string; // ISO
  agentId: string;
  division: DivisionId;
  field?: string;
  wrongValue?: unknown;
  correctValue?: unknown;
  correctedBy: HumanOwner;
  note?: string;
}

export interface CorrectionStore {
  append(c: CorrectionEvent): Promise<void>;
  countInWindow(sinceISO: string, untilISO: string): Promise<number>;
  hasAnyEverRecorded(): Promise<boolean>;
}

// ============================================================
// In-memory implementations — tests + local dev
// ============================================================

export class InMemoryPauseSink implements PauseSink {
  private readonly paused = new Map<string, PausedAgentRecord>();

  async pauseAgent(record: PausedAgentRecord): Promise<void> {
    this.paused.set(record.agentId, structuredClone(record));
  }
  async isPaused(agentId: string): Promise<boolean> {
    return this.paused.has(agentId);
  }
  async listPaused(): Promise<PausedAgentRecord[]> {
    return [...this.paused.values()].map((r) => structuredClone(r));
  }
  async unpauseAgent(agentId: string, _reason: string): Promise<void> {
    this.paused.delete(agentId);
  }
  _clear(): void {
    this.paused.clear();
  }
}

export class InMemoryViolationStore implements ViolationStore {
  private readonly items: PolicyViolation[] = [];
  private anyEver = false;

  async append(v: PolicyViolation): Promise<void> {
    this.items.push(structuredClone(v));
    this.anyEver = true;
  }
  async listInWindow(sinceISO: string, untilISO: string): Promise<PolicyViolation[]> {
    const s = new Date(sinceISO).getTime();
    const u = new Date(untilISO).getTime();
    return this.items
      .filter((v) => {
        const t = new Date(v.detectedAt).getTime();
        return t >= s && t <= u;
      })
      .map((v) => structuredClone(v));
  }
  async hasAnyEverRecorded(): Promise<boolean> {
    return this.anyEver;
  }
  _clear(): void {
    this.items.length = 0;
    this.anyEver = false;
  }
}

export class InMemoryCorrectionStore implements CorrectionStore {
  private readonly items: CorrectionEvent[] = [];
  private anyEver = false;

  async append(c: CorrectionEvent): Promise<void> {
    this.items.push(structuredClone(c));
    this.anyEver = true;
  }
  async countInWindow(sinceISO: string, untilISO: string): Promise<number> {
    const s = new Date(sinceISO).getTime();
    const u = new Date(untilISO).getTime();
    return this.items.filter((c) => {
      const t = new Date(c.at).getTime();
      return t >= s && t <= u;
    }).length;
  }
  async hasAnyEverRecorded(): Promise<boolean> {
    return this.anyEver;
  }
  _clear(): void {
    this.items.length = 0;
    this.anyEver = false;
  }
}
