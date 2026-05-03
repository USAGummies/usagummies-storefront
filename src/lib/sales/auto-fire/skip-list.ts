/**
 * Auto-fire skip-list — KV-backed cooldown so a single buyer can't get
 * the same nudge fired against them every day.
 *
 * Without this, the auto-fire orchestrator would surface the same
 * candidate to #ops-approvals every morning until either Ben approves
 * or the underlying detector clears the candidate. Approving once
 * shouldn't immediately re-queue the same buyer — they need time to
 * respond before another nudge.
 *
 * Cooldowns by nudge type (real-world response windows):
 *   • reorder-offer    — 30 days (one shot per quarter; a buyer who
 *                        ignored a reorder offer doesn't need another
 *                        one for at least a month)
 *   • sample-touch-2   — 21 days (two-touch is enough; if they
 *                        don't reply by touch-3 they're gone)
 *   • onboarding-nudge — 7 days (faster cycle — onboarding flows
 *                        rot quickly; if a 7-day nudge doesn't
 *                        unblock, manual review is the right path)
 */
import { kv } from "@vercel/kv";

export type NudgeKind =
  | "reorder-offer"
  | "sample-touch-2"
  | "onboarding-nudge";

const COOLDOWN_TTL_SECONDS: Record<NudgeKind, number> = {
  "reorder-offer": 30 * 24 * 3600,
  "sample-touch-2": 21 * 24 * 3600,
  "onboarding-nudge": 7 * 24 * 3600,
};

const KEY_PREFIX = "auto-fire-nudges:skip:";

/**
 * Build a stable skip-key from kind + buyer email. We key by email
 * because the same buyer might appear under different candidate ids
 * across detectors (e.g. HubSpot deal id vs onboarding flow id).
 * Lowercase + trim to dedupe trivial variants.
 */
function skipKey(kind: NudgeKind, buyerEmail: string): string {
  const norm = buyerEmail.trim().toLowerCase();
  return `${KEY_PREFIX}${kind}:${norm}`;
}

/**
 * True if this buyer has been nudged with this kind inside the
 * cooldown window. Fail-soft: KV miss/error → returns false (better
 * to risk a duplicate nudge than to permanently silence a buyer when
 * KV is having a bad day).
 */
export async function wasNudgedRecently(
  kind: NudgeKind,
  buyerEmail: string,
): Promise<boolean> {
  try {
    const v = await kv.get(skipKey(kind, buyerEmail));
    return v !== null && v !== undefined;
  } catch {
    return false;
  }
}

/**
 * Mark a buyer as nudged for this kind. Sets a kind-specific TTL
 * cooldown. Fail-soft on KV errors — the audit envelope is still
 * the source of truth for "did we send."
 */
export async function markNudged(
  kind: NudgeKind,
  buyerEmail: string,
): Promise<void> {
  const ttl = COOLDOWN_TTL_SECONDS[kind];
  try {
    await kv.set(skipKey(kind, buyerEmail), new Date().toISOString(), {
      ex: ttl,
    });
  } catch {
    /* fail-soft */
  }
}

export const __INTERNAL_FOR_TESTS = {
  COOLDOWN_TTL_SECONDS,
  skipKey,
};
