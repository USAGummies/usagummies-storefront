/**
 * Sample queue health — Phase D2 of the B2B Revenue Operating Loop.
 *
 * Doctrine: `/contracts/session-handoff.md` "Active build directive"
 * Phase D — sample-queue health is the second sub-lane after D1
 * (stale-buyer detection).
 *
 * D1 already surfaces "Sample Shipped > 10d stale" deals. D2 adds the
 * COMPLEMENTARY view that D1 misses:
 *
 *   - "Sample Requested" deals = the awaiting-ship queue. These are
 *     buyers who said yes to a sample, and are now waiting on Drew
 *     (East Coast) or Ben (Ashford) to actually pack the box.
 *   - The active "Sample Shipped" funnel size — how big is the
 *     follow-up queue right now?
 *   - Aging tail: oldest sample-requested deal (capacity signal — when
 *     this gets old, Drew/Ben are behind).
 *
 * Together D1 + D2 give the morning brief a complete sample-funnel
 * picture without adding a separate dashboard.
 *
 * Pure functions only. No I/O. The HubSpot fetcher is shared with D1
 * (`listRecentDeals` in `src/lib/ops/hubspot-client.ts`).
 */
import { HUBSPOT } from "@/lib/ops/hubspot-client";

import type { HubSpotDealForStaleness } from "./stale-buyer";
import { daysBetween } from "./stale-buyer";

/** Default threshold (days) for flagging a sample-requested as "behind". */
export const SAMPLE_REQUESTED_BEHIND_THRESHOLD_DAYS = 3;

/**
 * Roll-up summary for the morning-brief sample-queue slice.
 */
export interface SampleQueueHealth {
  asOf: string;
  /** Total deals in Sample Requested (waiting to ship). */
  awaitingShip: number;
  /** Sample Requested deals older than `behindThresholdDays`. */
  awaitingShipBehind: number;
  /** Total deals in Sample Shipped (waiting on buyer follow-up). */
  shippedAwaitingResponse: number;
  /** Days of the OLDEST Sample Requested deal (Infinity when none / no activity). */
  oldestRequestedDays: number;
  /** Days of the OLDEST Sample Shipped deal (Infinity when none / no activity). */
  oldestShippedDays: number;
  /** Threshold used for `awaitingShipBehind`. */
  behindThresholdDays: number;
  /** Source citation per `/contracts/governance.md` §1 #2. */
  source: { system: "hubspot"; retrievedAt: string };
}

/**
 * Compute the sample-queue health snapshot from a list of HubSpot
 * deals + a `now` timestamp + the source citation.
 *
 * Active-stage filter is applied internally — the caller can pass any
 * `HubSpotDealForStaleness[]` (the same list the D1 caller uses) and
 * D2 picks out only the Sample Requested + Sample Shipped subset.
 */
export function computeSampleQueueHealth(
  deals: HubSpotDealForStaleness[],
  now: Date,
  retrievedAt: string,
  opts: { behindThresholdDays?: number } = {},
): SampleQueueHealth {
  const behindThresholdDays =
    opts.behindThresholdDays ?? SAMPLE_REQUESTED_BEHIND_THRESHOLD_DAYS;

  const requested = deals.filter(
    (d) =>
      d.pipelineId === HUBSPOT.PIPELINE_B2B_WHOLESALE &&
      d.stageId === HUBSPOT.STAGE_SAMPLE_REQUESTED,
  );
  const shipped = deals.filter(
    (d) =>
      d.pipelineId === HUBSPOT.PIPELINE_B2B_WHOLESALE &&
      d.stageId === HUBSPOT.STAGE_SAMPLE_SHIPPED,
  );

  const requestedAges = requested.map((d) => daysBetween(now, d.lastActivityAt));
  const shippedAges = shipped.map((d) => daysBetween(now, d.lastActivityAt));

  const awaitingShipBehind = requestedAges.filter(
    (a) => a >= behindThresholdDays,
  ).length;

  const oldestRequested =
    requestedAges.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...requestedAges);
  const oldestShipped =
    shippedAges.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...shippedAges);

  return {
    asOf: now.toISOString(),
    awaitingShip: requested.length,
    awaitingShipBehind,
    shippedAwaitingResponse: shipped.length,
    oldestRequestedDays: Number.isFinite(oldestRequested)
      ? Math.floor(oldestRequested)
      : Number.POSITIVE_INFINITY,
    oldestShippedDays: Number.isFinite(oldestShipped)
      ? Math.floor(oldestShipped)
      : Number.POSITIVE_INFINITY,
    behindThresholdDays,
    source: { system: "hubspot", retrievedAt },
  };
}
