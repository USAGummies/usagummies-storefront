/**
 * Wholesale onboarding-flow KV persistence layer — Phase 35.e
 * substrate for the route layer (Phase 35.f).
 *
 * Persists `OnboardingState` from `src/lib/wholesale/onboarding-flow.ts`
 * across HTTP requests so a multi-step flow can resume after page
 * reloads, route hops, or AP-ack delays. Mirrors the conventions
 * used by `src/lib/wholesale/inquiries.ts`:
 *
 *   - String keys, REST-flavor `@vercel/kv` (no Redis lists).
 *   - JSON-serialized envelopes with a TTL backstop.
 *   - An index for "list recent flows" (capped to keep size bounded).
 *
 * **Key layout:**
 *   `wholesale:flow:<flowId>`        — JSON-serialized OnboardingState.
 *   `wholesale:flow:index`           — JSON array of flowIds (most-recent
 *                                      first, capped at INDEX_CAP).
 *
 * **Hard rules** (tested):
 *   1. **Source-attested ids.** `flowId` must be a non-empty string.
 *      Callers that don't have one yet should call `mintFlowId()`.
 *   2. **Idempotent saves.** `saveOnboardingState(state)` overwrites
 *      cleanly; the index dedupes by id.
 *   3. **Honest reads.** `loadOnboardingState(id)` returns `null` for
 *      a missing record, NEVER a synthetic empty state. Callers must
 *      distinguish "not found" from "step 1 incomplete".
 *   4. **Bounded growth.** Index capped at 5,000 flows; per-record
 *      TTL = 30 days (a flow that takes longer than 30 days to
 *      complete is operationally dead — Rene re-onboards manually).
 *
 * **Pure persistence — no side effects.** This module never fires
 * HubSpot/QBO/Slack/AP-packet writes. The route layer reads
 * `sideEffectsForStep()` and dispatches; the store just persists.
 */
import { kv } from "@vercel/kv";
import { randomUUID } from "node:crypto";

import type { OnboardingState } from "./onboarding-flow";

// ---------------------------------------------------------------------------
// KV layout
// ---------------------------------------------------------------------------

const KV_RECORD_PREFIX = "wholesale:flow:";
const KV_INDEX_KEY = "wholesale:flow:index";
const INDEX_CAP = 5000;
const RECORD_TTL_SECONDS = 30 * 24 * 3600;

function recordKey(flowId: string): string {
  return `${KV_RECORD_PREFIX}${flowId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Mint a stable, URL-safe flow id. Use at step 1 (`info`). */
export function mintFlowId(): string {
  return `wf_${randomUUID()}`;
}

/**
 * Persist an OnboardingState. Idempotent — overwrites any prior
 * record at the same flowId. Updates the index so list operations
 * surface the most-recent flow first.
 *
 * Throws on empty `flowId` (defense — never persist a record we
 * can't look up later).
 */
export async function saveOnboardingState(
  state: OnboardingState,
): Promise<void> {
  if (!state.flowId.trim()) {
    throw new Error("saveOnboardingState: flowId required");
  }
  await kv.set(recordKey(state.flowId), JSON.stringify(state), {
    ex: RECORD_TTL_SECONDS,
  });
  const existing = await readIndex();
  const next = [
    state.flowId,
    ...existing.filter((id) => id !== state.flowId),
  ].slice(0, INDEX_CAP);
  await kv.set(KV_INDEX_KEY, next);
}

/**
 * Load a previously-persisted flow. Returns `null` when the record
 * is missing (TTL expired, index lag, or never created). Callers
 * MUST treat `null` as "flow not found" — NOT as "step 1
 * incomplete".
 *
 * Recovers from JSON corruption by returning `null` (defensive —
 * better to force a fresh start than to load a half-parsed state).
 */
export async function loadOnboardingState(
  flowId: string,
): Promise<OnboardingState | null> {
  if (!flowId.trim()) return null;
  const raw = await kv.get<string | OnboardingState>(recordKey(flowId));
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as OnboardingState;
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * List the N most-recent flows. Used by an internal ops surface
 * (Phase 35.f+) to spot flows that stalled mid-onboarding so Rene
 * can chase the lead. Bounded by `limit` (default 50, max 500).
 */
export async function listRecentFlows(opts: {
  limit?: number;
} = {}): Promise<OnboardingState[]> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  const ids = await readIndex();
  const out: OnboardingState[] = [];
  for (const id of ids.slice(0, limit)) {
    const state = await loadOnboardingState(id);
    if (state) out.push(state);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readIndex(): Promise<string[]> {
  const raw = await kv.get<string[] | string>(KV_INDEX_KEY);
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Order-captured snapshots (Phase 35.f.3 — kv.write-order-captured side effect)
// ---------------------------------------------------------------------------
//
// When the flow reaches `order-captured` we persist a denormalized
// snapshot under its own key prefix. This serves two jobs:
//   1. Audit trail — a tamper-resistant marker that the customer
//      acknowledged intent. Independent of OnboardingState mutations.
//   2. Rene's stalled-flow review surface — list captured orders that
//      haven't yet completed (Phase 35.f.4+).

const KV_ORDER_CAPTURED_PREFIX = "wholesale:order-captured:";
const ORDER_CAPTURED_TTL_SECONDS = 90 * 24 * 3600;

export interface OrderCapturedSnapshot {
  flowId: string;
  capturedAt: string;
  paymentPath?: "credit-card" | "accounts-payable";
  prospect?: OnboardingState["prospect"];
  orderLines: OnboardingState["orderLines"];
}

function orderCapturedKey(flowId: string): string {
  return `${KV_ORDER_CAPTURED_PREFIX}${flowId}`;
}

/**
 * Persist a `wholesale-order-captured` snapshot. Pure-write — no
 * index. The snapshot is a denormalized projection of the state
 * at order-captured time so consumers can read it without paging
 * through the full OnboardingState envelope.
 */
export async function writeOrderCapturedSnapshot(
  state: OnboardingState,
  capturedAt: Date = new Date(),
): Promise<OrderCapturedSnapshot> {
  if (!state.flowId.trim()) {
    throw new Error("writeOrderCapturedSnapshot: flowId required");
  }
  const snapshot: OrderCapturedSnapshot = {
    flowId: state.flowId,
    capturedAt: capturedAt.toISOString(),
    paymentPath: state.paymentPath,
    prospect: state.prospect,
    orderLines: state.orderLines,
  };
  await kv.set(orderCapturedKey(state.flowId), JSON.stringify(snapshot), {
    ex: ORDER_CAPTURED_TTL_SECONDS,
  });
  return snapshot;
}

/** Read a previously-persisted snapshot. Returns null if missing. */
export async function readOrderCapturedSnapshot(
  flowId: string,
): Promise<OrderCapturedSnapshot | null> {
  if (!flowId.trim()) return null;
  const raw = await kv.get<string | OrderCapturedSnapshot>(
    orderCapturedKey(flowId),
  );
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as OrderCapturedSnapshot;
    } catch {
      return null;
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Audit envelopes — completed-flow snapshots for monthly close + month-end
// summaries (Phase 35.f.6.b — supports Rene's monthly review cadence)
// ---------------------------------------------------------------------------
//
// The dispatcher writes a `wholesale:audit:flow-complete:<flowId>` envelope
// when a flow reaches `crm-updated`. To support "list completed flows in the
// last N days" we maintain a separate index keyed by completion timestamp.
//
// Layout:
//   `wholesale:audit:flow-complete:<flowId>`        — JSON envelope (1y TTL).
//   `wholesale:audit:flow-complete:index`           — JSON array of
//                                                     `{ flowId, completedAt }`,
//                                                     most-recent first,
//                                                     capped at AUDIT_INDEX_CAP.

const KV_AUDIT_PREFIX = "wholesale:audit:flow-complete:";
const KV_AUDIT_INDEX_KEY = "wholesale:audit:flow-complete:index";
const AUDIT_INDEX_CAP = 5000;
const AUDIT_TTL_SECONDS = 365 * 24 * 3600;

function auditKey(flowId: string): string {
  return `${KV_AUDIT_PREFIX}${flowId}`;
}

export interface AuditEnvelope {
  flowId: string;
  completedAt: string;
  stepsCompleted: readonly string[];
  paymentPath?: "credit-card" | "accounts-payable";
  prospect?: OnboardingState["prospect"];
  orderLineCount: number;
  hubspotDealId?: string;
  qboCustomerApprovalId?: string;
  /** Optional — sum of order-line subtotals at completion. */
  totalSubtotalUsd?: number;
}

interface AuditIndexEntry {
  flowId: string;
  completedAt: string;
}

async function readAuditIndex(): Promise<AuditIndexEntry[]> {
  const raw = await kv.get<AuditIndexEntry[] | string>(KV_AUDIT_INDEX_KEY);
  if (Array.isArray(raw)) {
    return raw.filter(
      (e): e is AuditIndexEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as AuditIndexEntry).flowId === "string" &&
        typeof (e as AuditIndexEntry).completedAt === "string",
    );
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (e): e is AuditIndexEntry =>
            typeof e === "object" &&
            e !== null &&
            typeof (e as AuditIndexEntry).flowId === "string" &&
            typeof (e as AuditIndexEntry).completedAt === "string",
        );
      }
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Persist an audit envelope + update the index. Used by the
 * dispatcher's `auditFlowComplete` handler. Pure logic + KV writes;
 * no other side effects. Idempotent — re-saving the same flowId
 * overwrites the envelope and dedupes the index.
 */
export async function writeAuditEnvelope(
  envelope: AuditEnvelope,
): Promise<void> {
  if (!envelope.flowId.trim()) {
    throw new Error("writeAuditEnvelope: flowId required");
  }
  if (!envelope.completedAt) {
    throw new Error("writeAuditEnvelope: completedAt required");
  }
  await kv.set(auditKey(envelope.flowId), JSON.stringify(envelope), {
    ex: AUDIT_TTL_SECONDS,
  });
  const existing = await readAuditIndex();
  const next: AuditIndexEntry[] = [
    { flowId: envelope.flowId, completedAt: envelope.completedAt },
    ...existing.filter((e) => e.flowId !== envelope.flowId),
  ].slice(0, AUDIT_INDEX_CAP);
  await kv.set(KV_AUDIT_INDEX_KEY, next);
}

/**
 * Read a single audit envelope by flowId. Returns null on missing
 * or corrupt records — same honest-read posture as
 * `loadOnboardingState`.
 */
export async function readAuditEnvelope(
  flowId: string,
): Promise<AuditEnvelope | null> {
  if (!flowId.trim()) return null;
  const raw = await kv.get<string | AuditEnvelope>(auditKey(flowId));
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as AuditEnvelope;
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * List the N most-recent completed-flow audit envelopes. Optionally
 * filter to those completed within the last `withinDays` days
 * (used for monthly close + month-end summaries).
 */
export async function listRecentAuditEnvelopes(opts: {
  limit?: number;
  withinDays?: number;
} = {}): Promise<AuditEnvelope[]> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const cutoffMs =
    opts.withinDays !== undefined
      ? Date.now() - opts.withinDays * 24 * 3600 * 1000
      : null;
  const index = await readAuditIndex();
  const out: AuditEnvelope[] = [];
  for (const entry of index) {
    if (out.length >= limit) break;
    if (
      cutoffMs !== null &&
      new Date(entry.completedAt).getTime() < cutoffMs
    ) {
      continue;
    }
    const env = await readAuditEnvelope(entry.flowId);
    if (env) out.push(env);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test helpers — NOT exported from a barrel
// ---------------------------------------------------------------------------

export const __INTERNAL = {
  KV_RECORD_PREFIX,
  KV_INDEX_KEY,
  INDEX_CAP,
  RECORD_TTL_SECONDS,
  KV_ORDER_CAPTURED_PREFIX,
  ORDER_CAPTURED_TTL_SECONDS,
  KV_AUDIT_PREFIX,
  KV_AUDIT_INDEX_KEY,
  AUDIT_INDEX_CAP,
  AUDIT_TTL_SECONDS,
  recordKey,
  readIndex,
  orderCapturedKey,
  auditKey,
  readAuditIndex,
};
