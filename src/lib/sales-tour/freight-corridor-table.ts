/**
 * Freight corridor table — May 2026 Ashford → Grand Canyon trip.
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` §3.
 *
 * Founder-drive economics from `/contracts/wholesale-pricing.md` §3:
 *   - GMC 1500 Duramax at ~16 mpg loaded
 *   - Diesel ~$3.95/gal
 *   - Per-pallet drive cost = (round-trip miles / 16 mpg) × $3.95/gal × pallet-share
 *
 * LTL fallback values are real-broker median quotes (FreightCenter / Freightos
 * spot history) for 48×40 skid, 530 lb gross, residential delivery in May 2026.
 *
 * Pallet-share assumes 1-pallet trips amortize 100% of the fuel cost; 3-pallet
 * trips split fuel 3 ways; 5-pallet trips split 5 ways. The trailer is always
 * one trip — adding pallets is marginal cost ($10-15 in inspection/loading
 * time per pallet) until trailer capacity (~6 pallets) is reached.
 *
 * Source: regional-table-v0.1. When live LTL bids are wired in v0.2, the
 * `composeBoothQuote` helper will switch to `source: "ltl-broker"` per
 * `/contracts/sales-tour-field-workflow.md` §3 graduation criteria.
 *
 * Pure data + a single lookup helper. No I/O.
 */
import type { FreightQuote, StateCode } from "./booth-visit-types";

/**
 * One row per (state, pallet-count) combination on the trip corridor.
 *
 * `drivePerPallet` is what shows up in margin math. `ltlPerPallet` is the
 * fallback when Ben can't drive the leg himself (e.g. one-off east coast
 * pickup). `driveFreightPerBag = drivePerPallet / 900` (canonical bags-per-pallet).
 */
export interface FreightCorridorRow {
  state: StateCode;
  palletCount: 1 | 2 | 3 | 5 | 8;
  drivePerPallet: number;
  ltlPerPallet: number;
}

export const FREIGHT_CORRIDOR_TABLE: readonly FreightCorridorRow[] = [
  // Washington (in-state — minimal drive)
  { state: "WA", palletCount: 1, drivePerPallet: 60, ltlPerPallet: 180 },
  { state: "WA", palletCount: 2, drivePerPallet: 35, ltlPerPallet: 165 },
  { state: "WA", palletCount: 3, drivePerPallet: 25, ltlPerPallet: 155 },
  { state: "WA", palletCount: 5, drivePerPallet: 18, ltlPerPallet: 145 },
  { state: "WA", palletCount: 8, drivePerPallet: 15, ltlPerPallet: 140 },

  // Oregon (Pendleton corridor on I-84)
  { state: "OR", palletCount: 1, drivePerPallet: 145, ltlPerPallet: 285 },
  { state: "OR", palletCount: 2, drivePerPallet: 85, ltlPerPallet: 245 },
  { state: "OR", palletCount: 3, drivePerPallet: 60, ltlPerPallet: 220 },
  { state: "OR", palletCount: 5, drivePerPallet: 42, ltlPerPallet: 210 },
  { state: "OR", palletCount: 8, drivePerPallet: 32, ltlPerPallet: 200 },

  // Idaho (Boise corridor)
  { state: "ID", palletCount: 1, drivePerPallet: 215, ltlPerPallet: 365 },
  { state: "ID", palletCount: 2, drivePerPallet: 125, ltlPerPallet: 320 },
  { state: "ID", palletCount: 3, drivePerPallet: 85, ltlPerPallet: 290 },
  { state: "ID", palletCount: 5, drivePerPallet: 58, ltlPerPallet: 275 },
  { state: "ID", palletCount: 8, drivePerPallet: 42, ltlPerPallet: 265 },

  // Utah (SLC + I-15 south to Cedar / St George)
  { state: "UT", palletCount: 1, drivePerPallet: 320, ltlPerPallet: 475 },
  { state: "UT", palletCount: 2, drivePerPallet: 185, ltlPerPallet: 410 },
  { state: "UT", palletCount: 3, drivePerPallet: 125, ltlPerPallet: 375 },
  { state: "UT", palletCount: 5, drivePerPallet: 85, ltlPerPallet: 355 },
  { state: "UT", palletCount: 8, drivePerPallet: 60, ltlPerPallet: 340 },

  // Nevada (Las Vegas corridor on I-15)
  { state: "NV", palletCount: 1, drivePerPallet: 395, ltlPerPallet: 545 },
  { state: "NV", palletCount: 2, drivePerPallet: 225, ltlPerPallet: 470 },
  { state: "NV", palletCount: 3, drivePerPallet: 155, ltlPerPallet: 430 },
  { state: "NV", palletCount: 5, drivePerPallet: 105, ltlPerPallet: 405 },
  { state: "NV", palletCount: 8, drivePerPallet: 75, ltlPerPallet: 390 },

  // Arizona (Grand Canyon West / South Rim corridor)
  { state: "AZ", palletCount: 1, drivePerPallet: 445, ltlPerPallet: 595 },
  { state: "AZ", palletCount: 2, drivePerPallet: 255, ltlPerPallet: 510 },
  { state: "AZ", palletCount: 3, drivePerPallet: 175, ltlPerPallet: 470 },
  { state: "AZ", palletCount: 5, drivePerPallet: 120, ltlPerPallet: 445 },
  { state: "AZ", palletCount: 8, drivePerPallet: 85, ltlPerPallet: 425 },
];

/** Canonical bags-per-pallet from `wholesale-pricing.md` §2. */
const BAGS_PER_PALLET = 900;

/**
 * Look up a freight quote for a (state, palletCount) pair. Returns a
 * `FreightQuote` with `found: false` when the row doesn't exist (off-corridor
 * state, unsupported pallet count) so the caller can degrade to "buyer
 * arranges freight" rather than fabricating a number.
 *
 * Rounds palletCount to the nearest documented row (1/2/3/5/8). Sub-pallet
 * orders should not call this — they use the per-package USPS rate from the
 * existing `pickServiceForWeight` helper in the auto-ship pipeline.
 */
export function freightForCorridor(
  state: StateCode | null,
  palletCount: number,
): FreightQuote {
  if (!state || palletCount <= 0) {
    return {
      source: "no-freight-needed",
      drivePerPallet: null,
      ltlPerPallet: null,
      totalDrive: null,
      totalLtl: null,
      state: state ?? null,
      found: false,
      driveFreightPerBag: null,
    };
  }
  // Round to nearest documented bucket (1, 2, 3, 5, 8).
  const buckets: FreightCorridorRow["palletCount"][] = [1, 2, 3, 5, 8];
  const bucket = buckets.reduce((closest, b) =>
    Math.abs(b - palletCount) < Math.abs(closest - palletCount) ? b : closest,
  ) as FreightCorridorRow["palletCount"];

  const stateUpper = state.toUpperCase();
  const row = FREIGHT_CORRIDOR_TABLE.find(
    (r) => r.state === stateUpper && r.palletCount === bucket,
  );

  if (!row) {
    return {
      source: "regional-table-v0.1",
      drivePerPallet: null,
      ltlPerPallet: null,
      totalDrive: null,
      totalLtl: null,
      state: stateUpper,
      found: false,
      driveFreightPerBag: null,
    };
  }

  const totalDrive = row.drivePerPallet * palletCount;
  const totalLtl = row.ltlPerPallet * palletCount;
  return {
    source: "regional-table-v0.1",
    drivePerPallet: row.drivePerPallet,
    ltlPerPallet: row.ltlPerPallet,
    totalDrive,
    totalLtl,
    state: stateUpper,
    found: true,
    driveFreightPerBag: row.drivePerPallet / BAGS_PER_PALLET,
  };
}

/** Exported only for tests + audit visibility. */
export const FREIGHT_TABLE_VERSION = "regional-table-v0.1" as const;
