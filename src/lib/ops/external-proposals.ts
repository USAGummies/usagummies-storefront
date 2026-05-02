/**
 * External Agent + GTM Tool Adapter Layer — Build 8.
 *
 * Per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md §4 Build 8:
 *
 *   "Let tools like Polsia, Sola, Reevo, OpenAI workspace agents, and
 *   Claude Code help the business without becoming uncontrolled
 *   systems of record."
 *
 *   Principle:
 *     - HubSpot remains CRM source of truth.
 *     - Slack remains Ben's command board.
 *     - Repo-native routes remain the only execution path for
 *       sensitive writes.
 *     - External tools may propose work, drafts, leads, research,
 *       and code prompts.
 *
 * This module defines the **inbound proposal schema** + **KV-backed
 * queue**. External tools `POST /api/ops/external-proposals` to
 * register a proposal; that endpoint validates + persists the
 * envelope; operator surfaces (`/ops/external-proposals` UI + Slack
 * `proposals` card) read it; if Ben approves, the action enters the
 * existing `requestApproval()` Class B/C flow on the repo side.
 *
 * Hard rules baked into the validator (locked by tests):
 *   - source tool MUST be in `EXTERNAL_PROPOSAL_SOURCES`
 *   - department MUST be in `EXTERNAL_PROPOSAL_DEPARTMENTS`
 *   - riskClass MUST be one of:
 *       "read_only"        — informational only; no action is implied.
 *       "draft_only"       — a draft artifact (email body, code prompt,
 *                            research note). Operator manually copies
 *                            into the real surface.
 *       "approval_required" — the proposal asks for an action that
 *                            would mutate state. Execution path MUST
 *                            be a known approval slug; the repo opens
 *                            the actual approval, not the external tool.
 *   - PROHIBITED riskClass values are rejected at ingest. The blueprint
 *     enumerates the prohibited set:
 *       * HubSpot stages/properties direct mutation
 *       * Gmail send
 *       * QBO write
 *       * Shopify cart/pricing/checkout/product mutation
 *       * Ad spend launch/change
 *       * ShipStation label buy
 *     These are caught structurally — proposals that name a mutation
 *     verb in their `proposedAction` are auto-flagged for operator
 *     review (`flags: ["claims_direct_mutation"]`) and downgraded to
 *     `risk_class: "approval_required"` at ingest.
 *
 * Pure-logic where possible. KV I/O is wrapped in fail-soft helpers.
 */
import { kv } from "@vercel/kv";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const EXTERNAL_PROPOSAL_SOURCES = [
  "polsia",
  "sola",
  "reevo",
  "openai-workspace",
  "claude-code",
  "codex",
  "other",
] as const;
export type ExternalProposalSource =
  (typeof EXTERNAL_PROPOSAL_SOURCES)[number];

export const EXTERNAL_PROPOSAL_DEPARTMENTS = [
  "sales",
  "finance",
  "email",
  "shipping",
  "marketing",
  "research",
  "ops",
  "general",
] as const;
export type ExternalProposalDepartment =
  (typeof EXTERNAL_PROPOSAL_DEPARTMENTS)[number];

export const EXTERNAL_PROPOSAL_RISK_CLASSES = [
  "read_only",
  "draft_only",
  "approval_required",
] as const;
export type ExternalProposalRiskClass =
  (typeof EXTERNAL_PROPOSAL_RISK_CLASSES)[number];

export const EXTERNAL_PROPOSAL_STATUSES = [
  "queued",
  "reviewed",
  "promoted",
  "rejected",
  "expired",
] as const;
export type ExternalProposalStatus =
  (typeof EXTERNAL_PROPOSAL_STATUSES)[number];

/**
 * Mutation verbs that, if found in `proposedAction`, force the
 * proposal into `approval_required` even if the source claimed
 * `read_only` / `draft_only`. Substring match, case-insensitive.
 */
const MUTATION_VERB_PATTERNS: ReadonlyArray<RegExp> = [
  // "Send … email/gmail/message" — allow connector words between verb and noun.
  /\bsend\b[^.\n]*\b(email|gmail|message)\b/i,
  /\bcreate\s+(?:a\s+|an\s+|the\s+)?(deal|invoice|bill|order|label|shipment|customer|product)/i,
  /\bupdate\s+(?:the\s+|a\s+|an\s+)?(stage|deal|invoice|properties|inventory|cart|pricing|checkout|product)/i,
  /\bdelete\b/i,
  /\bpost\s+(?:a\s+|the\s+)?(invoice|bill|payment|charge)/i,
  /\bcharge\s+(?:the\s+|a\s+)?card/i,
  /\bbuy\s+(?:a\s+|the\s+)?label/i,
  /\blaunch\s+(?:a\s+|the\s+)?(campaign|ad)/i,
  /\bchange\s+(?:the\s+|a\s+)?(spend|budget|bid)/i,
  /\bclose\s+won\b/i,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExternalProposalEntityRef {
  /** What kind of entity — free-form, validated against length. */
  type: string;
  /** Optional id (HubSpot deal id, Shopify order id, etc.). */
  id?: string;
  /** Optional URL for click-through. */
  url?: string;
}

export interface ExternalProposalEvidence {
  /** One-line summary of why the source recommends this. */
  claim: string;
  /** Optional sources / citations for the claim. */
  sources?: ReadonlyArray<{ system: string; id?: string; url?: string }>;
  /** 0..1 confidence — surfaced to Ben so he can prioritize. */
  confidence?: number;
}

export interface ExternalProposalInput {
  source: ExternalProposalSource;
  /** Stable id from the source tool (e.g. Polsia run id). */
  sourceRunId?: string;
  department: ExternalProposalDepartment;
  /** Short title — what Ben sees first in Slack/UI. */
  title: string;
  /**
   * Free-form proposed action — what the source recommends doing.
   * Auto-scanned for mutation verbs to set `flags`.
   */
  proposedAction: string;
  /**
   * Optional reference to an entity in our systems (HubSpot deal,
   * Shopify order, etc.). Read-only — we don't trust the external
   * tool to mutate this.
   */
  entityRef?: ExternalProposalEntityRef;
  /** Evidence the source provides. */
  evidence: ExternalProposalEvidence;
  /** Source-claimed risk class — may be downgraded by validator. */
  riskClass: ExternalProposalRiskClass;
  /**
   * Optional execution path. When set, must be an approval slug from
   * the canonical taxonomy. The repo opens the approval; the external
   * tool never executes directly.
   */
  executionPath?: string;
  /**
   * Free-form blocked actions list — what the source acknowledges it
   * is NOT allowed to do. Surfaced in the Slack card for transparency.
   */
  blockedActions?: ReadonlyArray<string>;
  /** Free-form notes / draft body. */
  notes?: string;
}

export interface ExternalProposalRecord extends ExternalProposalInput {
  id: string;
  status: ExternalProposalStatus;
  /** Validator-computed flags (e.g. "claims_direct_mutation"). */
  flags: ReadonlyArray<string>;
  createdAt: string;
  updatedAt: string;
  /** When status moved off "queued", who decided. */
  reviewedBy?: string;
  reviewerNote?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationResult =
  | {
      ok: true;
      input: ExternalProposalInput;
      flags: string[];
      effectiveRiskClass: ExternalProposalRiskClass;
    }
  | { ok: false; error: string };

const TITLE_MAX = 200;
const ACTION_MAX = 1000;
const NOTES_MAX = 4000;

/**
 * Validate an inbound proposal payload. Returns the cleaned input + any
 * flags the validator set. Mutation verbs in `proposedAction` force the
 * effective risk class up to `approval_required`.
 */
export function validateExternalProposalInput(
  raw: unknown,
): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "request body required" };
  }
  const r = raw as Record<string, unknown>;

  const source = r.source as ExternalProposalSource;
  if (!EXTERNAL_PROPOSAL_SOURCES.includes(source)) {
    return {
      ok: false,
      error: `source must be one of: ${EXTERNAL_PROPOSAL_SOURCES.join(", ")}`,
    };
  }
  const department = r.department as ExternalProposalDepartment;
  if (!EXTERNAL_PROPOSAL_DEPARTMENTS.includes(department)) {
    return {
      ok: false,
      error: `department must be one of: ${EXTERNAL_PROPOSAL_DEPARTMENTS.join(", ")}`,
    };
  }
  const claimedRisk = r.riskClass as ExternalProposalRiskClass;
  if (!EXTERNAL_PROPOSAL_RISK_CLASSES.includes(claimedRisk)) {
    return {
      ok: false,
      error: `riskClass must be one of: ${EXTERNAL_PROPOSAL_RISK_CLASSES.join(", ")}`,
    };
  }
  const title = strField(r.title, TITLE_MAX);
  if (!title) return { ok: false, error: "title required (≤200 chars)" };
  const proposedAction = strField(r.proposedAction, ACTION_MAX);
  if (!proposedAction)
    return { ok: false, error: "proposedAction required (≤1000 chars)" };

  const evidenceRaw = (r.evidence as Record<string, unknown> | undefined) ?? {};
  const evidenceClaim = strField(evidenceRaw.claim, 500);
  if (!evidenceClaim)
    return { ok: false, error: "evidence.claim required (≤500 chars)" };
  const evidenceSourcesRaw = Array.isArray(evidenceRaw.sources)
    ? (evidenceRaw.sources as Array<Record<string, unknown>>)
    : [];
  const evidenceSources: Array<{ system: string; id?: string; url?: string }> =
    [];
  for (const s of evidenceSourcesRaw) {
    const sys = strField(s.system, 80);
    if (!sys) continue;
    evidenceSources.push({
      system: sys,
      id: strField(s.id, 200) || undefined,
      url: strField(s.url, 500) || undefined,
    });
  }
  const confidence =
    typeof evidenceRaw.confidence === "number"
      ? Math.max(0, Math.min(1, evidenceRaw.confidence))
      : undefined;

  // Detect direct-mutation claims and force approval_required.
  const flags: string[] = [];
  let effectiveRiskClass = claimedRisk;
  for (const pat of MUTATION_VERB_PATTERNS) {
    if (pat.test(proposedAction)) {
      flags.push("claims_direct_mutation");
      effectiveRiskClass = "approval_required";
      break;
    }
  }

  // Optional fields
  const sourceRunId = strField(r.sourceRunId, 200) || undefined;
  let entityRef: ExternalProposalEntityRef | undefined;
  const entityRaw = r.entityRef as Record<string, unknown> | undefined;
  if (entityRaw) {
    const type = strField(entityRaw.type, 80);
    if (!type) {
      return { ok: false, error: "entityRef.type required when entityRef present" };
    }
    entityRef = {
      type,
      id: strField(entityRaw.id, 200) || undefined,
      url: strField(entityRaw.url, 500) || undefined,
    };
  }
  const executionPath = strField(r.executionPath, 200) || undefined;
  const blockedActionsRaw = Array.isArray(r.blockedActions)
    ? (r.blockedActions as unknown[])
    : [];
  const blockedActions: string[] = [];
  for (const b of blockedActionsRaw) {
    const v = strField(b, 200);
    if (v) blockedActions.push(v);
  }
  const notes = strField(r.notes, NOTES_MAX) || undefined;

  return {
    ok: true,
    flags,
    effectiveRiskClass,
    input: {
      source,
      sourceRunId,
      department,
      title,
      proposedAction,
      entityRef,
      evidence: {
        claim: evidenceClaim,
        sources: evidenceSources.length > 0 ? evidenceSources : undefined,
        confidence,
      },
      riskClass: effectiveRiskClass,
      executionPath,
      blockedActions: blockedActions.length > 0 ? blockedActions : undefined,
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// KV layer
// ---------------------------------------------------------------------------

const KV_INDEX = "ops:external-proposals:index";
const KV_PREFIX = "ops:external-proposals:item:";
const INDEX_CAP = 500;

export interface AppendOpts {
  /** Override timestamp / id for tests. */
  now?: Date;
  id?: string;
  store?: KvLikeStore;
}

export interface KvLikeStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

const defaultStore: KvLikeStore = {
  get: async <T>(key: string) => (await kv.get<T>(key)) ?? null,
  set: (key, value) => kv.set(key, value),
  lpush: (key, value) => kv.lpush(key, value),
  ltrim: (key, start, stop) => kv.ltrim(key, start, stop),
  lrange: (key, start, stop) => kv.lrange(key, start, stop),
};

/** Append a validated proposal to the queue. Returns the persisted record. */
export async function appendExternalProposal(
  input: ExternalProposalInput,
  flags: ReadonlyArray<string>,
  opts: AppendOpts = {},
): Promise<ExternalProposalRecord> {
  const store = opts.store ?? defaultStore;
  const now = opts.now ?? new Date();
  const id = opts.id ?? `ext-${randomUUID()}`;
  const record: ExternalProposalRecord = {
    ...input,
    id,
    status: "queued",
    flags: [...flags],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await store.set(`${KV_PREFIX}${id}`, record);
  await store.lpush(KV_INDEX, id);
  await store.ltrim(KV_INDEX, 0, INDEX_CAP - 1);
  return record;
}

/** Read recent proposals (newest first). Fail-soft. */
export async function listExternalProposals(opts: {
  limit?: number;
  store?: KvLikeStore;
} = {}): Promise<{
  records: ExternalProposalRecord[];
  degraded: string[];
}> {
  const limit = Math.max(1, Math.min(INDEX_CAP, opts.limit ?? 50));
  const store = opts.store ?? defaultStore;
  const degraded: string[] = [];
  let ids: string[] = [];
  try {
    ids = await store.lrange(KV_INDEX, 0, limit - 1);
  } catch (err) {
    degraded.push(
      `index:${err instanceof Error ? err.message : String(err)}`,
    );
    return { records: [], degraded };
  }
  const records: ExternalProposalRecord[] = [];
  for (const id of ids) {
    try {
      const rec = await store.get<ExternalProposalRecord>(
        `${KV_PREFIX}${id}`,
      );
      if (rec) records.push(rec);
    } catch (err) {
      degraded.push(
        `get:${id}:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { records, degraded };
}

/** Fetch a single proposal by id. */
export async function getExternalProposal(
  id: string,
  store: KvLikeStore = defaultStore,
): Promise<ExternalProposalRecord | null> {
  try {
    return await store.get<ExternalProposalRecord>(`${KV_PREFIX}${id}`);
  } catch {
    return null;
  }
}

/** Transition a proposal status. Locked transitions: queued → {reviewed, rejected}, reviewed → {promoted, rejected}. */
export async function updateExternalProposalStatus(args: {
  id: string;
  next: ExternalProposalStatus;
  reviewedBy?: string;
  reviewerNote?: string;
  now?: Date;
  store?: KvLikeStore;
}): Promise<ExternalProposalRecord | null> {
  const store = args.store ?? defaultStore;
  const existing = await getExternalProposal(args.id, store);
  if (!existing) return null;
  if (!isValidTransition(existing.status, args.next)) {
    return null;
  }
  const updated: ExternalProposalRecord = {
    ...existing,
    status: args.next,
    reviewedBy: args.reviewedBy ?? existing.reviewedBy,
    reviewerNote: args.reviewerNote ?? existing.reviewerNote,
    updatedAt: (args.now ?? new Date()).toISOString(),
  };
  await store.set(`${KV_PREFIX}${args.id}`, updated);
  return updated;
}

/** Pure transition guard. Exported for tests. */
export function isValidTransition(
  from: ExternalProposalStatus,
  to: ExternalProposalStatus,
): boolean {
  if (from === to) return true; // idempotent
  switch (from) {
    case "queued":
      return to === "reviewed" || to === "rejected" || to === "expired";
    case "reviewed":
      return to === "promoted" || to === "rejected" || to === "expired";
    case "promoted":
    case "rejected":
    case "expired":
      return false; // terminal
  }
}

// ---------------------------------------------------------------------------
// Roll-up summary (for Slack card / dashboard)
// ---------------------------------------------------------------------------

export interface ExternalProposalsSummary {
  total: number;
  queued: number;
  reviewed: number;
  promoted: number;
  rejected: number;
  byDepartment: Record<string, number>;
  bySource: Record<string, number>;
  flaggedDirectMutation: number;
  /** Top 5 newest queued proposals — for the Slack card. */
  topQueued: ExternalProposalRecord[];
}

export function summarizeExternalProposals(
  records: ReadonlyArray<ExternalProposalRecord>,
  opts: { topN?: number } = {},
): ExternalProposalsSummary {
  const summary: ExternalProposalsSummary = {
    total: records.length,
    queued: 0,
    reviewed: 0,
    promoted: 0,
    rejected: 0,
    byDepartment: {},
    bySource: {},
    flaggedDirectMutation: 0,
    topQueued: [],
  };
  for (const r of records) {
    if (r.status === "queued") summary.queued += 1;
    if (r.status === "reviewed") summary.reviewed += 1;
    if (r.status === "promoted") summary.promoted += 1;
    if (r.status === "rejected") summary.rejected += 1;
    summary.byDepartment[r.department] =
      (summary.byDepartment[r.department] ?? 0) + 1;
    summary.bySource[r.source] = (summary.bySource[r.source] ?? 0) + 1;
    if (r.flags.includes("claims_direct_mutation")) {
      summary.flaggedDirectMutation += 1;
    }
  }
  const queued = records.filter((r) => r.status === "queued");
  const sorted = [...queued].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  summary.topQueued = sorted.slice(0, opts.topN ?? 5);
  return summary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function strField(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const trimmed = v.trim();
  if (trimmed.length === 0) return "";
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
