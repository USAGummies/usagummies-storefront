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
// Test helpers — NOT exported from a barrel
// ---------------------------------------------------------------------------

export const __INTERNAL = {
  KV_RECORD_PREFIX,
  KV_INDEX_KEY,
  INDEX_CAP,
  RECORD_TTL_SECONDS,
  recordKey,
  readIndex,
};
