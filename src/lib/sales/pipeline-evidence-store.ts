/**
 * Pipeline Evidence — KV I/O boundary.
 *
 * Per-deal evidence list lives at `sales:pipeline-evidence:<dealId>`
 * as a single JSON array. Reads return the array; writes append.
 *
 * The transition log lives at `sales:pipeline-transitions:<dealId>`
 * as another JSON array — each entry written when the verified stage
 * actually changes (operator-driven; the verifier doesn't write
 * transitions on its own).
 *
 * Fail-soft: KV errors return empty arrays + a degraded note. The
 * route layer uses the degraded list to surface "we couldn't read
 * the trail" instead of falsely reporting "no evidence."
 */
import { kv } from "@vercel/kv";
import { randomUUID } from "node:crypto";

import type {
  PipelineEvidence,
  PipelineStage,
  PipelineTransition,
} from "./pipeline-evidence";

const KV_EVIDENCE_PREFIX = "sales:pipeline-evidence:";
const KV_TRANSITION_PREFIX = "sales:pipeline-transitions:";
const MAX_PER_DEAL = 200; // cap so a runaway scanner can't blow KV

export interface KvLikePipelineStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
}

const defaultStore: KvLikePipelineStore = {
  get: async <T>(key: string) => (await kv.get<T>(key)) ?? null,
  set: (key, value) => kv.set(key, value),
};

// ---------------------------------------------------------------------------
// Evidence read/write
// ---------------------------------------------------------------------------

export async function listPipelineEvidence(
  dealId: string,
  store: KvLikePipelineStore = defaultStore,
): Promise<{ evidence: PipelineEvidence[]; degraded: string[] }> {
  const degraded: string[] = [];
  let evidence: PipelineEvidence[] = [];
  try {
    evidence =
      (await store.get<PipelineEvidence[]>(
        `${KV_EVIDENCE_PREFIX}${dealId}`,
      )) ?? [];
  } catch (err) {
    degraded.push(
      `evidence:${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { evidence, degraded };
}

export interface AppendEvidenceInput {
  dealId: string;
  stage: PipelineStage;
  evidenceType: PipelineEvidence["evidenceType"];
  source: string;
  sourceId: string;
  url?: string;
  evidenceAt: string;
  actor: string;
  confidence: number;
  note?: string;
}

export async function appendPipelineEvidence(
  input: AppendEvidenceInput,
  opts: { now?: Date; id?: string; store?: KvLikePipelineStore } = {},
): Promise<PipelineEvidence> {
  const store = opts.store ?? defaultStore;
  const now = opts.now ?? new Date();
  const recordedAt = now.toISOString();
  const id = opts.id ?? `pev-${randomUUID()}`;
  const evidence: PipelineEvidence = {
    id,
    dealId: input.dealId,
    stage: input.stage,
    evidenceType: input.evidenceType,
    source: input.source,
    sourceId: input.sourceId,
    url: input.url,
    evidenceAt: input.evidenceAt,
    actor: input.actor,
    confidence: clamp01(input.confidence),
    note: input.note,
    recordedAt,
  };
  const key = `${KV_EVIDENCE_PREFIX}${input.dealId}`;
  const current =
    (await store.get<PipelineEvidence[]>(key).catch(() => null)) ?? [];
  // Idempotency: if a row with the same source+sourceId+stage already
  // exists, don't double-record.
  const dup = current.find(
    (e) =>
      e.stage === input.stage &&
      e.source === input.source &&
      e.sourceId === input.sourceId &&
      e.evidenceType === input.evidenceType,
  );
  if (dup) return dup;
  const next = [...current, evidence].slice(-MAX_PER_DEAL);
  await store.set(key, next);
  return evidence;
}

// ---------------------------------------------------------------------------
// Transition log read/write
// ---------------------------------------------------------------------------

export async function listPipelineTransitions(
  dealId: string,
  store: KvLikePipelineStore = defaultStore,
): Promise<{ transitions: PipelineTransition[]; degraded: string[] }> {
  const degraded: string[] = [];
  let transitions: PipelineTransition[] = [];
  try {
    transitions =
      (await store.get<PipelineTransition[]>(
        `${KV_TRANSITION_PREFIX}${dealId}`,
      )) ?? [];
  } catch (err) {
    degraded.push(
      `transitions:${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { transitions, degraded };
}

export async function appendPipelineTransition(
  dealId: string,
  transition: PipelineTransition,
  store: KvLikePipelineStore = defaultStore,
): Promise<PipelineTransition[]> {
  const key = `${KV_TRANSITION_PREFIX}${dealId}`;
  const current =
    (await store.get<PipelineTransition[]>(key).catch(() => null)) ?? [];
  const next = [...current, transition].slice(-MAX_PER_DEAL);
  await store.set(key, next);
  return next;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
