/**
 * ATP (Available-to-Promise) Gate — USA Gummies
 *
 * Prevents over-promising outbound cartons beyond what the Ashford
 * warehouse has on hand. Consumed by the Shipping Hub buy-label
 * route before purchasing labels.
 *
 * Model (MVP, 2026-04-20):
 *   - Single-SKU assumption: today all wholesale shipments are
 *     "All American Gummy Bears 7.5 oz Bag" (SKU UG-AAGB-6CT).
 *     Total bags available = sum of on-hand across every tracked
 *     Shopify SKU (future-proofs the one-SKU case + covers the few
 *     retail variants that may exist).
 *   - Case = 6 bags, Master carton = 36 bags. Matches the 6×6×1
 *     packaging spec in `/contracts/integrations/shipstation.md` §5.
 *   - Pending outbound = sum of `cartonsRequired × bagsPerCarton`
 *     across every `fulfillment:stages` entry NOT yet in stage
 *     `shipped` (excluding the keys currently being bought, which
 *     are counted from `newBags` instead to avoid double-counting).
 *   - Risk:
 *       - `ok`:    onHand - pendingOutbound - newBags >= 0
 *       - `warn`:  onHand - pendingOutbound - newBags < 0 but ≥ -24
 *                 (within a master carton → may still be fine once
 *                 Shopify reconciles today's shipments)
 *       - `block`: deficit exceeds 24 bags → real over-promise
 *
 * This module is pure — no side-effects, no I/O. The route passes in
 * the inventory snapshot + stage map + new-cartons delta.
 */

import type { InventorySnapshot } from "./inventory-snapshot";

export type AtpRiskLevel = "ok" | "warn" | "block";

/** Bag counts per packaging type — matches PACKAGE_PROFILES doctrine. */
export const BAGS_PER_CARTON: Record<"case" | "master_carton", number> = {
  case: 6,
  master_carton: 36,
};

/**
 * A minimal stage shape. We intentionally avoid importing the concrete
 * type from the buy-label route to keep this module standalone /
 * testable without Next.js route imports.
 */
export interface AtpStageEntry {
  stage: "received" | "packed" | "ready" | "shipped";
  cartonsRequired: number;
  packagingType?: "case" | "master_carton";
}

export type AtpStageMap = Record<string, AtpStageEntry>;

export interface AtpGateResult {
  risk: AtpRiskLevel;
  totalBagsOnHand: number | null;
  pendingOutboundBags: number;
  newOutboundBags: number;
  projectedDeficit: number; // positive = how many bags we'd be short
  reason: string;
  /**
   * Suggested max cartons the buyer could safely purchase given
   * current on-hand + pending. null when on-hand is unknown.
   */
  safeMaxCartons: number | null;
  /** Snapshot `ageHours` — warns if stale. */
  snapshotAgeHours: number | null;
}

export interface AtpGateInput {
  snapshot: InventorySnapshot | null;
  /** Current `fulfillment:stages` (all keys — module filters). */
  stages: AtpStageMap;
  /** Keys being bought RIGHT NOW; exclude these from pending sum. */
  excludeKeys: string[];
  /** Cartons about to be purchased in this label buy. */
  newCartons: number;
  /** Packaging type for the new cartons (case / master_carton). */
  newPackagingType: "case" | "master_carton";
  /**
   * Hard-block threshold in bags. Default 24 — within a master carton
   * of deficit is `warn`; beyond that is `block`.
   */
  blockDeficitThreshold?: number;
}

export function evaluateAtp(input: AtpGateInput): AtpGateResult {
  const blockThreshold = input.blockDeficitThreshold ?? 24;

  // On-hand: sum across every row in the snapshot. Null if snapshot
  // missing — caller treats as "unavailable, don't block".
  let totalBagsOnHand: number | null = null;
  let snapshotAgeHours: number | null = null;
  if (input.snapshot) {
    totalBagsOnHand = input.snapshot.rows.reduce(
      (sum, r) => sum + (r.onHand || 0),
      0,
    );
    snapshotAgeHours =
      Math.round(
        ((Date.now() - new Date(input.snapshot.generatedAt).getTime()) /
          3_600_000) *
          10,
      ) / 10;
  }

  // Pending outbound from fulfillment:stages, excluding the keys being
  // bought right now (those are counted via newBags).
  const excludeSet = new Set(input.excludeKeys);
  let pendingOutboundBags = 0;
  for (const [key, entry] of Object.entries(input.stages)) {
    if (excludeSet.has(key)) continue;
    if (entry.stage === "shipped") continue;
    const bagsPerCarton =
      BAGS_PER_CARTON[entry.packagingType ?? "master_carton"] ?? 36;
    pendingOutboundBags += (entry.cartonsRequired ?? 0) * bagsPerCarton;
  }

  const newOutboundBags =
    input.newCartons * (BAGS_PER_CARTON[input.newPackagingType] ?? 36);

  if (totalBagsOnHand === null) {
    return {
      risk: "ok", // unknown → don't block; caller surfaces as warning
      totalBagsOnHand: null,
      pendingOutboundBags,
      newOutboundBags,
      projectedDeficit: 0,
      reason:
        "Inventory snapshot unavailable — ATP gate skipped. POST /api/ops/inventory/snapshot to populate.",
      safeMaxCartons: null,
      snapshotAgeHours: null,
    };
  }

  const projectedBalance =
    totalBagsOnHand - pendingOutboundBags - newOutboundBags;
  const projectedDeficit = projectedBalance < 0 ? -projectedBalance : 0;

  // Compute a safe max for the buyer's UI to suggest.
  const remainingBags = totalBagsOnHand - pendingOutboundBags;
  const bagsPerNewCarton = BAGS_PER_CARTON[input.newPackagingType] ?? 36;
  const safeMaxCartons = Math.max(
    0,
    Math.floor(remainingBags / bagsPerNewCarton),
  );

  let risk: AtpRiskLevel = "ok";
  let reason = `Projected balance after this buy: ${projectedBalance} bags (on-hand ${totalBagsOnHand} − pending ${pendingOutboundBags} − new ${newOutboundBags}).`;
  if (projectedDeficit > 0) {
    risk = projectedDeficit > blockThreshold ? "block" : "warn";
    reason =
      `Over-promise risk (${risk}): projected deficit ${projectedDeficit} bags. ` +
      `On-hand ${totalBagsOnHand} · pending outbound ${pendingOutboundBags} · this buy ${newOutboundBags}. ` +
      `Safe max: ${safeMaxCartons} cartons of ${input.newPackagingType}.`;
  } else if (snapshotAgeHours !== null && snapshotAgeHours > 24) {
    reason += ` Snapshot is ${snapshotAgeHours}h stale — consider POSTing /api/ops/inventory/snapshot to refresh.`;
  }

  return {
    risk,
    totalBagsOnHand,
    pendingOutboundBags,
    newOutboundBags,
    projectedDeficit,
    reason,
    safeMaxCartons,
    snapshotAgeHours,
  };
}
