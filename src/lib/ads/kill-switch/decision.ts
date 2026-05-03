/**
 * Ad-spend kill-switch decision logic — pure function.
 *
 * Decides whether yesterday's Meta + Google ad spend warrants a kill
 * card. The actual data fetching lives in the route; this module is
 * the policy.
 *
 * The rule (Ben's "burn watch" doctrine, derived from the 2026-09→04
 * Google Ads $1,678 → 0 conversions disaster):
 *
 *   • spendUsd > $100 AND conversions === 0  →  kill (urgent)
 *   • spendUsd > $50  AND conversions === 0  →  warn (P2)
 *   • CPA > $50 (cost per conversion)        →  warn (P2)
 *   • Anything else                           →  ok (silent)
 *
 * The kill threshold is intentionally low. The 7-month leak that
 * inspired this surface ran at ~$95/week with zero conversions —
 * a $100 daily threshold would catch that leak in one day instead
 * of seven months.
 */

export type KillSwitchSeverity = "kill" | "warn" | "ok";

/** Per-platform daily spend snapshot. */
export interface AdSpendSnapshot {
  platform: "meta" | "google";
  /** True when the platform is configured and the fetch returned data. */
  available: boolean;
  /** Yesterday's spend in USD. Null when unavailable. */
  spendUsd: number | null;
  /** Yesterday's conversion count. Null when unavailable. */
  conversions: number | null;
  /** Optional unavailable reason (e.g. "META_ACCESS_TOKEN not configured"). */
  unavailableReason?: string;
}

/** Single-platform decision. */
export interface KillSwitchPlatformDecision {
  platform: "meta" | "google";
  severity: KillSwitchSeverity;
  spendUsd: number | null;
  conversions: number | null;
  cpaUsd: number | null;
  reason: string;
  unavailableReason?: string;
}

/** Aggregated decision. */
export interface KillSwitchDecision {
  /** Worst-case severity across both platforms. */
  overallSeverity: KillSwitchSeverity;
  /** True when at least one platform is in kill state. */
  shouldKill: boolean;
  perPlatform: KillSwitchPlatformDecision[];
  /** Total spend across both platforms (only available rows). */
  totalSpendUsd: number;
  /** Total conversions across both platforms (only available rows). */
  totalConversions: number;
}

/** Default thresholds. Caller can override for testing. */
export const DEFAULT_KILL_SPEND_USD = 100;
export const DEFAULT_WARN_SPEND_USD = 50;
export const DEFAULT_WARN_CPA_USD = 50;

export interface KillSwitchThresholds {
  killSpendUsd: number;
  warnSpendUsd: number;
  warnCpaUsd: number;
}

const DEFAULTS: KillSwitchThresholds = {
  killSpendUsd: DEFAULT_KILL_SPEND_USD,
  warnSpendUsd: DEFAULT_WARN_SPEND_USD,
  warnCpaUsd: DEFAULT_WARN_CPA_USD,
};

function decideForPlatform(
  snap: AdSpendSnapshot,
  thresholds: KillSwitchThresholds,
): KillSwitchPlatformDecision {
  if (
    !snap.available ||
    snap.spendUsd === null ||
    snap.conversions === null
  ) {
    return {
      platform: snap.platform,
      severity: "ok",
      spendUsd: null,
      conversions: null,
      cpaUsd: null,
      reason: snap.unavailableReason ?? "unavailable — no data fetched",
      unavailableReason: snap.unavailableReason,
    };
  }

  const cpa =
    snap.conversions > 0
      ? Math.round((snap.spendUsd / snap.conversions) * 100) / 100
      : null;

  // 1. Hard kill — spend over threshold with zero conversions.
  if (snap.spendUsd > thresholds.killSpendUsd && snap.conversions === 0) {
    return {
      platform: snap.platform,
      severity: "kill",
      spendUsd: snap.spendUsd,
      conversions: snap.conversions,
      cpaUsd: cpa,
      reason: `spent $${snap.spendUsd.toFixed(2)} yesterday with zero conversions — exceeds $${thresholds.killSpendUsd} kill threshold`,
    };
  }

  // 2. Warn — spend > warn threshold but zero conversions.
  if (snap.spendUsd > thresholds.warnSpendUsd && snap.conversions === 0) {
    return {
      platform: snap.platform,
      severity: "warn",
      spendUsd: snap.spendUsd,
      conversions: snap.conversions,
      cpaUsd: cpa,
      reason: `spent $${snap.spendUsd.toFixed(2)} yesterday with zero conversions — above $${thresholds.warnSpendUsd} warn threshold`,
    };
  }

  // 3. Warn — CPA out of range (high cost per conversion).
  if (cpa !== null && cpa > thresholds.warnCpaUsd) {
    return {
      platform: snap.platform,
      severity: "warn",
      spendUsd: snap.spendUsd,
      conversions: snap.conversions,
      cpaUsd: cpa,
      reason: `CPA $${cpa.toFixed(2)} above $${thresholds.warnCpaUsd} warn threshold (${snap.conversions} conv on $${snap.spendUsd.toFixed(2)} spend)`,
    };
  }

  // 4. Healthy.
  return {
    platform: snap.platform,
    severity: "ok",
    spendUsd: snap.spendUsd,
    conversions: snap.conversions,
    cpaUsd: cpa,
    reason: `healthy: $${snap.spendUsd.toFixed(2)} spend → ${snap.conversions} conv${cpa !== null ? ` ($${cpa.toFixed(2)} CPA)` : ""}`,
  };
}

/**
 * Decide the kill-switch state from per-platform snapshots.
 * Pure function — no I/O.
 */
export function decideKillSwitch(
  snapshots: AdSpendSnapshot[],
  overrides: Partial<KillSwitchThresholds> = {},
): KillSwitchDecision {
  const thresholds: KillSwitchThresholds = { ...DEFAULTS, ...overrides };

  const perPlatform = snapshots.map((s) => decideForPlatform(s, thresholds));

  // Worst-case rule: kill > warn > ok.
  const sevRank: Record<KillSwitchSeverity, number> = {
    ok: 0,
    warn: 1,
    kill: 2,
  };
  const overallSeverity = perPlatform.reduce<KillSwitchSeverity>(
    (acc, d) => (sevRank[d.severity] > sevRank[acc] ? d.severity : acc),
    "ok",
  );

  const shouldKill = perPlatform.some((d) => d.severity === "kill");

  let totalSpendUsd = 0;
  let totalConversions = 0;
  for (const d of perPlatform) {
    if (d.spendUsd !== null) totalSpendUsd += d.spendUsd;
    if (d.conversions !== null) totalConversions += d.conversions;
  }
  totalSpendUsd = Math.round(totalSpendUsd * 100) / 100;

  return {
    overallSeverity,
    shouldKill,
    perPlatform,
    totalSpendUsd,
    totalConversions,
  };
}
