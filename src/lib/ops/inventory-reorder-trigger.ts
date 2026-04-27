/**
 * Inventory reorder trigger — Phase 30.2.
 *
 * The cover-days forecast (`forecastCoverDays` in
 * `inventory-forecast.ts`) already produces `reorderRecommended[]`
 * — every SKU below the urgency threshold (≤ 14d urgent, ≤ 30d
 * soon). What was missing: nothing actually FIRED on it. The
 * Inventory Specialist contract describes daily 14:30 UTC scans
 * + Slack alerts, but the surface didn't exist.
 *
 * This module is the closer: it takes a forecast, filters to the
 * subset that should trigger an alert today, and produces a single
 * Slack-renderable summary the route can post.
 *
 * Design choices:
 *   - **One alert per SKU per day, not per scan.** A 09:00 scan +
 *     a 14:00 scan should fire AT MOST one Slack post per
 *     low-cover SKU per day. KV dedup at the route layer; this
 *     module returns the dedup keys so the route can check.
 *   - **Urgent first, then soon.** Sort by cover-days ascending so
 *     the most-stressed SKU is first in the message.
 *   - **Honest "nothing to alert"** — empty forecast → empty
 *     candidates → quiet. Never fabricates "all good!" since the
 *     forecast may itself be degraded (snapshot read failed).
 *   - **Class A surface, not Class B.** This is `slack.post.audit`
 *     — surface the reorder need to `#operations`. The Class B
 *     `qbo.po.draft` proposal is a separate, deliberate human
 *     action. We don't queue an approval per low SKU; that would
 *     be approval spam.
 */
import type { CoverDaysForecast, CoverDaysRow } from "./inventory-forecast";

export interface ReorderCandidate extends CoverDaysRow {
  /** Stable dedup key: `inventory-reorder:<sku>:<YYYY-MM-DD>`. */
  dedupKey: string;
}

const KV_PREFIX = "inventory-reorder:alert:";

/**
 * Format a date as `YYYY-MM-DD` in UTC. Pure.
 */
export function formatYmdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build the dedup key for a SKU + day. Pure. */
export function buildReorderDedupKey(sku: string, day: string): string {
  return `${KV_PREFIX}${sku.toLowerCase()}:${day}`;
}

/**
 * Pick reorder candidates from a forecast.
 *
 * Filtering rules:
 *   - Only `urgency === "urgent"` or `urgency === "soon"` rows.
 *     `unknown` is NOT included (no burn rate → no defensible alert).
 *   - Sorted urgent-first, then by ascending coverDays (shortest
 *     cover first within each urgency).
 *   - Caps at `opts.limit` (default 10) so an extreme-fragmented
 *     catalog doesn't fill `#operations` with 50 SKU rows.
 *
 * Pure — no I/O, no clock side-effects beyond the explicit `now`.
 */
export function pickReorderCandidates(
  forecast: CoverDaysForecast,
  opts: { now?: Date; limit?: number } = {},
): ReorderCandidate[] {
  const now = opts.now ?? new Date();
  const day = formatYmdUtc(now);
  const limit = Math.max(1, Math.floor(opts.limit ?? 10));

  const ranked = [...forecast.reorderRecommended]
    .filter((r) => r.urgency === "urgent" || r.urgency === "soon")
    .sort((a, b) => {
      // Urgent before soon.
      if (a.urgency !== b.urgency) {
        return a.urgency === "urgent" ? -1 : 1;
      }
      // Within tier, shortest cover first.
      const ac = a.coverDays ?? Number.POSITIVE_INFINITY;
      const bc = b.coverDays ?? Number.POSITIVE_INFINITY;
      return ac - bc;
    });

  return ranked.slice(0, limit).map((r) => ({
    ...r,
    dedupKey: buildReorderDedupKey(r.sku, day),
  }));
}

/**
 * Render a single Slack message body summarizing the reorder
 * candidates. Empty list → empty string (quiet collapse).
 *
 * Format example:
 *
 *     :package: *Reorder watch — N SKUs below threshold*
 *     • USG-FBM-1PK — *3.2 days* (urgent, 800 on hand, ~250/day)
 *     • USG-FBM-3PK — *18.0 days* (soon, 4500 on hand, ~250/day)
 *     _Recommend: open `qbo.po.draft` (Class B, Ben) for the urgent
 *     SKUs. Forecast generated <ISO>._
 */
export function renderReorderSlackMessage(
  candidates: readonly ReorderCandidate[],
  forecast: CoverDaysForecast,
): string {
  if (candidates.length === 0) return "";
  const urgentCount = candidates.filter((c) => c.urgency === "urgent").length;
  const headline = `:package: *Reorder watch — ${candidates.length} SKU${candidates.length === 1 ? "" : "s"} below threshold${
    urgentCount > 0 ? ` (${urgentCount} urgent)` : ""
  }*`;
  const bullets = candidates.map((c) => {
    const cover =
      c.coverDays === null
        ? "?"
        : `${c.coverDays.toFixed(1)} day${c.coverDays === 1 ? "" : "s"}`;
    const burn = `${Math.round(c.burnRatePerDay)}/day`;
    return `• ${c.sku} — *${cover}* (${c.urgency}, ${c.onHand} on hand, ~${burn})`;
  });
  const footer = `_Recommend: open \`qbo.po.draft\` (Class B, Ben) for the urgent SKUs. Forecast generated ${forecast.generatedAt}._`;
  return [headline, ...bullets, footer].join("\n");
}

export interface ReorderTriggerOutcome {
  posted: number;
  skipped: number;
  candidates: readonly ReorderCandidate[];
  /** Skipped dedup keys — already alerted today. */
  skippedDedupKeys: readonly string[];
  /** Fired dedup keys — to be persisted by the caller. */
  firedDedupKeys: readonly string[];
}

/**
 * Filter candidates against an "already-alerted-today" predicate.
 * The route layer wires this to a KV `exists` check; the unit-test
 * layer passes a Set fixture.
 *
 * Pure.
 */
export function partitionAlreadyAlerted(
  candidates: readonly ReorderCandidate[],
  isAlertedToday: (dedupKey: string) => boolean,
): {
  fresh: readonly ReorderCandidate[];
  alreadyAlerted: readonly ReorderCandidate[];
} {
  const fresh: ReorderCandidate[] = [];
  const alreadyAlerted: ReorderCandidate[] = [];
  for (const c of candidates) {
    if (isAlertedToday(c.dedupKey)) alreadyAlerted.push(c);
    else fresh.push(c);
  }
  return { fresh, alreadyAlerted };
}
