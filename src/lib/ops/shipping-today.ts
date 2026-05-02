/**
 * Shipping Today — pure-logic aggregator for the daily shipping card.
 *
 * Build 2 close-out per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md §4
 * — completes the per-department roster (sales / finance / marketing /
 * email / **shipping** / proposals).
 *
 * Inputs (caller-provided, fail-soft):
 *   - dispatch retry queue (KV — already cached; cheap)
 *   - shipping-class pending approvals (production-supply-chain division)
 *   - ShipStation wallet balances (live API; optional — caller can skip)
 *
 * Pure module: no I/O, no env reads. The route layer + Slack handler
 * fetch raw inputs and feed them in here.
 */
import type { ApprovalRequest, DivisionId } from "./control-plane/types";
import type { DispatchRetryEntry } from "./dispatch-retry-queue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShippingWalletBalance {
  /** Carrier code (stamps_com / ups_walleted / fedex_walleted / etc). */
  carrierCode: string;
  /** Balance in USD. Null when fetch failed; surfaced as degraded. */
  balanceUsd: number | null;
  fetchError?: string;
}

export interface ShippingTodaySummary {
  generatedAt: string;
  /** Dispatch retry queue counts by status. */
  retryQueue: {
    total: number;
    pending: number;
    exhausted: number;
    /** Top 3 oldest pending entries — for the Slack card. */
    oldestPending: Array<{
      reason: string;
      enqueuedAt: string;
      attempts: number;
      ageMinutes: number;
    }>;
  };
  /** Pending shipping-class approvals (production-supply-chain division). */
  pendingApprovals: number;
  /** 5 oldest pending approvals (oldest first). */
  oldestPendingApprovals: Array<{
    id: string;
    actorAgentId: string;
    action: string;
    createdAt: string;
    ageDays: number;
  }>;
  /** Per-carrier wallet balances. Empty array when caller skipped fetch. */
  wallet: ShippingWalletBalance[];
  /** Carriers whose balance is below the alert threshold. */
  walletAlerts: Array<{ carrierCode: string; balanceUsd: number }>;
  /** Posture: green clean / yellow work waiting / red exhausted retry or wallet alert. */
  posture: "green" | "yellow" | "red";
  /** Sources that failed to load. */
  degraded: string[];
}

export interface ShippingTodayInput {
  retryQueue: ReadonlyArray<DispatchRetryEntry>;
  pendingApprovals: ReadonlyArray<ApprovalRequest>;
  wallet?: ReadonlyArray<ShippingWalletBalance>;
  /** Override "now" for deterministic tests. */
  now?: Date;
  /** Sources that failed (passed through). */
  degraded?: ReadonlyArray<string>;
  /** Wallet-alert threshold in USD. Default $25. */
  walletAlertThresholdUsd?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WALLET_ALERT_THRESHOLD = 25;
const TOP_N = 5;
const STALE_APPROVAL_DAYS = 3;

const SHIPPING_DIVISIONS: ReadonlySet<DivisionId> = new Set<DivisionId>([
  "production-supply-chain",
]);

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export function summarizeShippingToday(
  input: ShippingTodayInput,
): ShippingTodaySummary {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const walletThreshold =
    input.walletAlertThresholdUsd ?? DEFAULT_WALLET_ALERT_THRESHOLD;

  // ----- Retry queue -----
  let pending = 0;
  let exhausted = 0;
  for (const e of input.retryQueue) {
    if (e.status === "pending") pending += 1;
    else if (e.status === "exhausted") exhausted += 1;
  }
  const oldestPendingEntries = [...input.retryQueue]
    .filter((e) => e.status === "pending")
    .sort((a, b) => Date.parse(a.enqueuedAt) - Date.parse(b.enqueuedAt))
    .slice(0, 3)
    .map((e) => ({
      reason: e.reason,
      enqueuedAt: e.enqueuedAt,
      attempts: e.attempts,
      ageMinutes: Math.max(
        0,
        Math.round((nowMs - Date.parse(e.enqueuedAt)) / 60_000),
      ),
    }));

  // ----- Approvals -----
  const shippingPending = input.pendingApprovals.filter((a) =>
    SHIPPING_DIVISIONS.has(a.division),
  );
  const oldestPendingApprovals = [...shippingPending]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, TOP_N)
    .map((a) => ({
      id: a.id,
      actorAgentId: a.actorAgentId,
      action: a.action,
      createdAt: a.createdAt,
      ageDays: Math.max(
        0,
        Math.round((nowMs - Date.parse(a.createdAt)) / (24 * 3600 * 1000)),
      ),
    }));

  // ----- Wallet -----
  const wallet = (input.wallet ?? []).map((w) => ({ ...w }));
  const walletAlerts = wallet
    .filter(
      (w): w is ShippingWalletBalance & { balanceUsd: number } =>
        typeof w.balanceUsd === "number" && w.balanceUsd < walletThreshold,
    )
    .map((w) => ({ carrierCode: w.carrierCode, balanceUsd: w.balanceUsd }));

  // ----- Posture -----
  let posture: "green" | "yellow" | "red" = "green";
  if (
    exhausted > 0 ||
    walletAlerts.length > 0 ||
    oldestPendingApprovals.some((a) => a.ageDays >= STALE_APPROVAL_DAYS)
  ) {
    posture = "red";
  } else if (
    pending > 0 ||
    shippingPending.length > 0 ||
    wallet.some((w) => w.balanceUsd === null)
  ) {
    posture = "yellow";
  }

  return {
    generatedAt: now.toISOString(),
    retryQueue: {
      total: input.retryQueue.length,
      pending,
      exhausted,
      oldestPending: oldestPendingEntries,
    },
    pendingApprovals: shippingPending.length,
    oldestPendingApprovals,
    wallet,
    walletAlerts,
    posture,
    degraded: [...(input.degraded ?? [])],
  };
}
