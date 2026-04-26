/**
 * Weekly Revenue KPI Scorecard — pure helpers.
 *
 * Phase 4 of the Sales Command Center. Surfaces:
 *   • the operational completion standard (USA Gummies 3.0):
 *     **$1,000,000 in revenue by Dec 24, 2026 (end of day PT)**
 *   • required daily / weekly pace
 *   • actual last-7-day revenue across wired channels
 *   • gap (or surplus) to required pace
 *   • channel-by-channel source status (wired / not_wired / error)
 *
 * Hard rules (every one tested):
 *   - **Pure.** No I/O at all in this module.
 *   - **Never fabricates revenue.** A `not_wired` or `error` channel
 *     contributes ZERO to the displayed actual but its absence is
 *     surfaced via `confidence: "partial" | "none"` and per-channel
 *     reason strings — readers above are responsible for honest
 *     state propagation.
 *   - **Brief line never invents a number** when no channel is
 *     wired. The renderer falls back to "Revenue pace not fully
 *     wired." in that case.
 *   - **Date math is locked**: deadline is `2026-12-24T23:59:59-08:00`
 *     (end of day Pacific). `daysRemaining(now)` floors at 0.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Operational Completion Standard target. */
export const KPI_TARGET_USD = 1_000_000;

/**
 * End-of-day Pacific on Dec 24, 2026. Pacific Standard Time = UTC-8
 * (no DST in late December). Locked for testability — production
 * callers must NOT mutate this.
 */
export const KPI_TARGET_DEADLINE_ISO = "2026-12-24T23:59:59-08:00";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelKey =
  | "shopify"
  | "amazon"
  | "faire"
  | "b2b"
  | "unknown";

export type ChannelSourceStatus = "wired" | "not_wired" | "error";

/**
 * Per-channel last-7-day revenue contribution. The shape is the same
 * regardless of state — when state is `not_wired` or `error`,
 * `amountUsd` is `null` and `reason` carries the short why-string.
 */
export interface ChannelRevenueState {
  channel: ChannelKey;
  status: ChannelSourceStatus;
  amountUsd: number | null;
  /** Free-form reason — required when status is not_wired or error. */
  reason?: string;
  /** Source attribution for traceability — only present when wired. */
  source?: { system: string; retrievedAt: string };
}

/**
 * Confidence rubric for the whole scorecard:
 *   - "full"    — every primary channel (Shopify+Amazon+Faire) wired
 *   - "partial" — at least one wired and at least one not_wired/error
 *   - "none"    — zero wired channels (we have no actual to display)
 *
 * b2b moved into the primary set in Phase 5 (audit + wire) once a
 * defensible read-only source landed: Shopify orders with
 * `tag:wholesale AND financial_status:paid`. "unknown" remains a
 * permanent placeholder (catch-all for unattributed dollars) and
 * does NOT move the needle.
 */
export type KpiConfidence = "full" | "partial" | "none";

export interface RevenueKpiInput {
  channels: ChannelRevenueState[];
}

export interface RevenueKpiReport {
  generatedAt: string;
  target: {
    usd: number;
    deadlineIso: string;
  };
  daysRemaining: number;
  requiredDailyUsd: number;
  requiredWeeklyUsd: number;
  /** Sum of every wired channel's amountUsd. NEVER includes
   *  not_wired/error channels. `null` when no channel is wired. */
  actualLast7dUsd: number | null;
  /** `actualLast7dUsd - requiredWeeklyUsd`. Null when actual is null. */
  gapToWeeklyPaceUsd: number | null;
  channels: ChannelRevenueState[];
  confidence: KpiConfidence;
}

/** Compact slice carried by the morning brief. One line, no math
 *  dump — the dashboard is the full picture. */
export interface RevenueKpiSlice {
  text: string;
  /** True when the line had to fall back to "not fully wired" copy. */
  fullyWired: boolean;
}

// ---------------------------------------------------------------------------
// Date math
// ---------------------------------------------------------------------------

/**
 * Whole days from `now` to the locked KPI deadline. Floors at 0
 * (the deadline can pass; the renderer surfaces that as "0 days
 * remaining" rather than negative).
 */
export function daysRemaining(now: Date, deadlineIso = KPI_TARGET_DEADLINE_ISO): number {
  const deadlineMs = Date.parse(deadlineIso);
  if (!Number.isFinite(deadlineMs)) return 0;
  const diffMs = deadlineMs - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / DAY_MS);
}

/** Required pace per day to hit `target` over `daysRemaining(now)`. */
export function requiredDailyPaceUsd(
  now: Date,
  target = KPI_TARGET_USD,
  deadlineIso = KPI_TARGET_DEADLINE_ISO,
): number {
  const days = daysRemaining(now, deadlineIso);
  if (days <= 0) return 0;
  return target / days;
}

/** Required pace per week to hit `target` over `daysRemaining(now)`. */
export function requiredWeeklyPaceUsd(
  now: Date,
  target = KPI_TARGET_USD,
  deadlineIso = KPI_TARGET_DEADLINE_ISO,
): number {
  return requiredDailyPaceUsd(now, target, deadlineIso) * 7;
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/**
 * Primary channels that count toward `confidence`. B2B joined the
 * primary set in Phase 5 once Shopify wholesale-tagged paid orders
 * became a defensible read-only source. "unknown" is permanently
 * outside the rubric (catch-all placeholder).
 */
const PRIMARY_CHANNELS: ChannelKey[] = ["shopify", "amazon", "faire", "b2b"];

/**
 * Pure projection from per-channel state into the full report.
 * Always deterministic for the same input + `now`.
 */
export function composeRevenueKpi(
  input: RevenueKpiInput,
  options: { now?: Date; target?: number; deadlineIso?: string } = {},
): RevenueKpiReport {
  const now = options.now ?? new Date();
  const target = options.target ?? KPI_TARGET_USD;
  const deadlineIso = options.deadlineIso ?? KPI_TARGET_DEADLINE_ISO;

  const days = daysRemaining(now, deadlineIso);
  const requiredDailyUsd = requiredDailyPaceUsd(now, target, deadlineIso);
  const requiredWeeklyUsd = requiredWeeklyPaceUsd(now, target, deadlineIso);

  // Sum every wired channel. A wired channel always carries a finite
  // numeric amountUsd by reader contract; defensive coercion below
  // refuses NaN/Infinity if a future reader regresses.
  let wiredCount = 0;
  let actualLast7dUsd: number | null = null;
  for (const c of input.channels) {
    if (c.status !== "wired") continue;
    if (typeof c.amountUsd !== "number" || !Number.isFinite(c.amountUsd)) {
      // Defensive: a "wired" channel without a finite number is a
      // reader bug. Treat it as zero for the sum but keep the row's
      // status as wired — the dashboard will still surface the row.
      continue;
    }
    wiredCount += 1;
    actualLast7dUsd = (actualLast7dUsd ?? 0) + c.amountUsd;
  }

  const gapToWeeklyPaceUsd =
    actualLast7dUsd === null ? null : actualLast7dUsd - requiredWeeklyUsd;

  const confidence = computeConfidence(input.channels);

  return {
    generatedAt: now.toISOString(),
    target: { usd: target, deadlineIso },
    daysRemaining: days,
    requiredDailyUsd,
    requiredWeeklyUsd,
    actualLast7dUsd,
    gapToWeeklyPaceUsd,
    channels: input.channels.map((c) => ({ ...c })), // shallow copy so caller can't mutate report
    confidence,
  };
}

function computeConfidence(channels: ChannelRevenueState[]): KpiConfidence {
  // Rubric uses the LITERAL primary set — not "primaries present in
  // the input". A caller that omits a primary channel can't claim
  // "full" confidence by silence; the missing primary counts as
  // not-wired for the purposes of the rubric. This keeps the
  // scorecard honest under partial inputs.
  let wiredPrimary = 0;
  for (const key of PRIMARY_CHANNELS) {
    const c = channels.find((x) => x.channel === key);
    if (c && c.status === "wired") wiredPrimary += 1;
  }
  if (wiredPrimary === 0) return "none";
  if (wiredPrimary === PRIMARY_CHANNELS.length) return "full";
  return "partial";
}

// ---------------------------------------------------------------------------
// Brief one-liner
// ---------------------------------------------------------------------------

/**
 * Format a USD amount for compact display. <$10K → no decimals;
 * ≥$10K → "$12.4K"; ≥$1M → "$1.04M". Inputs are real dollars.
 */
export function formatUsdCompact(amount: number): string {
  if (!Number.isFinite(amount)) return "$—";
  const sign = amount < 0 ? "-" : "";
  const a = Math.abs(amount);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}$${(a / 1000).toFixed(1)}K`;
  if (a >= 1000) return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
  return `${sign}$${Math.round(a)}`;
}

/**
 * Render the morning-brief one-liner. NEVER fabricates a number —
 * if `actualLast7dUsd` is null (no channel wired), falls back to
 * the explicit "not fully wired" copy.
 *
 * Format examples:
 *   "Revenue pace: $24.1K last 7d vs $43.5K required/wk — gap -$19.4K (partial: amazon error)"
 *   "Revenue pace not fully wired."
 */
export function renderRevenueKpiBriefLine(report: RevenueKpiReport): RevenueKpiSlice {
  if (report.actualLast7dUsd === null) {
    return {
      text: "Revenue pace not fully wired.",
      fullyWired: false,
    };
  }
  const required = formatUsdCompact(report.requiredWeeklyUsd);
  const actual = formatUsdCompact(report.actualLast7dUsd);
  const gap = report.gapToWeeklyPaceUsd ?? 0;
  const gapStr =
    gap >= 0
      ? `+${formatUsdCompact(gap)} ahead`
      : `${formatUsdCompact(gap)} behind`;

  let suffix = "";
  if (report.confidence !== "full") {
    const dropped = report.channels
      .filter((c) => PRIMARY_CHANNELS.includes(c.channel) && c.status !== "wired")
      .map((c) => `${c.channel} ${c.status}`)
      .join(", ");
    suffix = dropped ? ` (${report.confidence}: ${dropped})` : ` (${report.confidence})`;
  }
  return {
    text: `Revenue pace: ${actual} last 7d vs ${required} required/wk — ${gapStr}${suffix}`,
    fullyWired: report.confidence === "full",
  };
}
