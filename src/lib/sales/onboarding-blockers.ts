/**
 * Wholesale-onboarding blockers — Phase D3 of the B2B Revenue Operating Loop.
 *
 * Doctrine: `/contracts/session-handoff.md` "Active build directive"
 * Phase D — D3 = "wholesale onboarding blockers". The data layer
 * already exists (Phase 35.f.5 — `/api/ops/wholesale/onboarding` for
 * Rene's review surface + `/api/ops/wholesale/onboarding-digest` for
 * the daily Slack post in `#financials`). D3's gap is surfacing the
 * same stall signal in the MORNING BRIEF (`#ops-daily`) as a tight
 * one-liner alongside D1/D2/D4 — so Ben sees the wholesale funnel
 * pulse without checking the dedicated dashboard.
 *
 * This module reuses the stall heuristic from the existing review
 * surface (currentStep has a `nextStep`, lastTimestamp is older than
 * `stallHours`) and projects each stalled flow into a brief-friendly
 * `OnboardingBlocker` shape with a per-step suggested next-action.
 *
 * Pure functions only. No I/O. The fetcher (`listRecentFlows`) is
 * called by the daily-brief route; this module classifies + rolls up.
 */
import {
  nextStep,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/wholesale/onboarding-flow";

/** Default stall threshold (hours). Mirrors the Rene-review surface default. */
export const DEFAULT_STALL_HOURS = 24;

/**
 * Per-step next-action templates for the morning brief.
 *
 * These are INTERNAL action prompts (Ben/Rene see them in
 * `#ops-daily`), not customer-facing copy. The chase-email path
 * (`src/lib/wholesale/chase-email.ts`) already produces buyer-facing
 * drafts; this map is the "what should Ben/Rene DO about it" line.
 */
export const STEP_NEXT_ACTIONS: Readonly<Record<OnboardingStep, string>> = {
  info: "Send first-touch chase via send-and-log.py — buyer left after entering company info",
  "store-type": "Resend the form link with a sample sell-sheet attached — buyer paused at store-type select",
  "pricing-shown": "Email buyer offering tier walkthrough — they saw pricing but didn't pick",
  "order-type": "Resend with a tier-aware quote — buyer didn't pick a B-tier",
  "payment-path": "Call buyer to clarify CC vs AP — they paused on payment path",
  "ap-info": "Email buyer requesting AP contact + tax ID — they didn't finish AP info",
  "order-captured": "Send AP packet (or invoice for CC) — order captured but next step pending",
  "shipping-info": "Email buyer to confirm ship-to — they didn't finish address entry",
  "ap-email-sent": "Chase AP department for ack on the packet we sent — they have it",
  "qbo-customer-staged": "Rene completes QBO vendor.master.create approval — pending Rene's review",
  "crm-updated": "Confirm HubSpot deal stage advanced + ship-from queue — final step pending",
};

/** A single stalled flow projected into brief-friendly shape. */
export interface OnboardingBlocker {
  flowId: string;
  /** Display name — prospect.companyName or fallback to flowId. */
  displayName: string;
  /** Current step the buyer is parked on. */
  currentStep: OnboardingStep;
  /** Days since the most-recent step transition. */
  daysSinceLastTouch: number;
  /** Stall threshold the flow crossed. */
  stallHours: number;
  /** Per-step next-action template. */
  nextAction: string;
  /** HubSpot deal id when wired (for cross-link). */
  hubspotDealId?: string;
  /** Total subtotal of the order (when an order line exists). */
  totalSubtotalUsd?: number;
}

/** Roll-up summary for the morning-brief slice. */
export interface OnboardingBlockersSummary {
  asOf: string;
  /** Top-N stalled flows, sorted by daysSinceLastTouch desc. */
  topBlockers: OnboardingBlocker[];
  /** Counts per step (only steps with at least one stalled flow). */
  byStep: Array<{ step: OnboardingStep; count: number }>;
  /** Total flows scanned (denominator). */
  flowsScanned: number;
  /** Total stalled (numerator). */
  stalledTotal: number;
  /** Threshold used for the stall check. */
  stallHours: number;
  /** Source citation per `/contracts/governance.md` §1 #2. */
  source: { system: "wholesale-onboarding-kv"; retrievedAt: string };
}

/** Most-recent step timestamp from the flow's `timestamps` map. */
function mostRecentTimestamp(state: OnboardingState): string | undefined {
  const stamps = Object.values(state.timestamps).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (stamps.length === 0) return undefined;
  return stamps.reduce((a, b) => (a > b ? a : b));
}

/**
 * Pure stall predicate. Mirrors the heuristic in
 * `/api/ops/wholesale/onboarding` route's `summarizeFlow`:
 *   - Flow has a non-null `nextStep` (i.e. NOT terminal).
 *   - `lastTimestamp` exists and is older than `stallHours`.
 *
 * Returns false for terminal-state flows (no nextStep) and for
 * brand-new flows with no recorded timestamps yet.
 */
export function isFlowStalled(
  state: OnboardingState,
  now: Date,
  stallHours: number,
): boolean {
  const next = nextStep(state);
  if (next === null) return false;
  const lastTs = mostRecentTimestamp(state);
  if (!lastTs) return false;
  const lastMs = Date.parse(lastTs);
  if (!Number.isFinite(lastMs)) return false;
  const stallMs = stallHours * 3_600_000;
  return now.getTime() - lastMs > stallMs;
}

/** Classify a single flow → `OnboardingBlocker` or null when not stalled. */
export function classifyOnboardingBlocker(
  state: OnboardingState,
  now: Date,
  stallHours: number,
): OnboardingBlocker | null {
  if (!isFlowStalled(state, now, stallHours)) return null;
  const lastTs = mostRecentTimestamp(state);
  if (!lastTs) return null;
  const days = Math.max(0, (now.getTime() - Date.parse(lastTs)) / 86_400_000);
  const totalSubtotalUsd = state.orderLines.reduce(
    (sum, line) => sum + line.subtotalUsd,
    0,
  );
  return {
    flowId: state.flowId,
    displayName: state.prospect?.companyName ?? `(flow ${state.flowId.slice(0, 8)})`,
    currentStep: state.currentStep,
    daysSinceLastTouch: Math.floor(days),
    stallHours,
    nextAction: STEP_NEXT_ACTIONS[state.currentStep] ?? "Review this flow manually",
    hubspotDealId: state.hubspotDealId,
    totalSubtotalUsd: state.orderLines.length > 0 ? Math.round(totalSubtotalUsd * 100) / 100 : undefined,
  };
}

/**
 * Compute the morning-brief summary from a list of onboarding flow
 * states + a `now` timestamp + the source citation. Returns the top-N
 * stalest plus per-step counts.
 *
 * Sort: `daysSinceLastTouch` desc within the same step priority.
 */
export function summarizeOnboardingBlockers(
  states: readonly OnboardingState[],
  now: Date,
  retrievedAt: string,
  opts: { topN?: number; stallHours?: number } = {},
): OnboardingBlockersSummary {
  const stallHours = opts.stallHours ?? DEFAULT_STALL_HOURS;
  const topN = opts.topN ?? 8;

  const blockers: OnboardingBlocker[] = [];
  for (const s of states) {
    const b = classifyOnboardingBlocker(s, now, stallHours);
    if (b) blockers.push(b);
  }

  const sorted = [...blockers].sort(
    (a, b) => b.daysSinceLastTouch - a.daysSinceLastTouch,
  );

  const byStepMap = new Map<OnboardingStep, number>();
  for (const b of blockers) {
    byStepMap.set(b.currentStep, (byStepMap.get(b.currentStep) ?? 0) + 1);
  }
  const byStep = Array.from(byStepMap.entries())
    .map(([step, count]) => ({ step, count }))
    .sort((a, b) => b.count - a.count);

  return {
    asOf: now.toISOString(),
    topBlockers: sorted.slice(0, topN),
    byStep,
    flowsScanned: states.length,
    stalledTotal: blockers.length,
    stallHours,
    source: { system: "wholesale-onboarding-kv", retrievedAt },
  };
}
