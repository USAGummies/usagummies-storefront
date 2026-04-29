/**
 * Wholesale batch SKU format — Phase 35.g (Rene + Viktor 2026-04-28).
 *
 * Implements the canonical batch-SKU naming scheme Rene + Viktor
 * landed on in the 2026-04-28 `#financials` thread:
 *
 *   `UG-B[NNNN]-[YYMMDD]-[FT]`
 *
 * where:
 *   UG       = USA Gummies brand prefix (future-proofs multi-line catalog)
 *   B[NNNN]  = Batch number, 4-digit zero-padded (B0001..B9999)
 *              Per Rene's 2026-04-28 directive: "make the numbering
 *              4 digits B0001 - if future batches are bigger we may
 *              need more than 999 total - gives us a little room"
 *   YYMMDD   = Pickup date from supplier (e.g. Powers).
 *              Compact form sorts chronologically as a string.
 *   [FT]     = Fulfillment-type code from `pricing-tiers.ts`:
 *              LCD / MCL / MCBF / PL / PBF
 *
 * Example: `UG-B0001-260415-MCL` = batch #1, picked up 2026-04-15,
 * Master Carton Landed.
 *
 * **Doctrinal rules** (tested):
 *   1. Batch numbers are immutable identifiers — a printed SKU
 *      points to a specific (batch, pickup-date, FT) tuple forever.
 *   2. Price is locked to the SKU at QBO-item creation time. Price
 *      changes always = NEW batch SKU; existing SKU prices are
 *      never edited (audit-trail preservation).
 *   3. SKU format is parseable both directions: `formatBatchSku()`
 *      and `parseBatchSku()` are inverses.
 *   4. The same physical batch can spawn multiple SKUs (one per
 *      fulfillment-type code) — they all share batch number +
 *      pickup date but differ on the FT segment.
 *
 * **Where this is consumed:**
 *   - QBO Products & Services entries — SKU field on each item
 *     uses `formatBatchSku(...)`.
 *   - QBO invoice line items pull SKU automatically from the
 *     product reference; SKU column on invoice template renders it.
 *   - Internal batch registry (Phase 35.g.b — separate KV-backed
 *     module) maps `batchNumber → { pickupDate, supplier, totalBags,
 *     unitCostUsd }` for FIFO inventory tracking.
 *
 * **NOT in scope here:**
 *   - Inventory deduction math (lives in a future inventory module)
 *   - Cross-batch FIFO selection (also future)
 *   - Re-pricing logic (always = new SKU; the batch registry is
 *     append-only)
 */
import {
  isFulfillmentType,
  type FulfillmentType,
} from "./pricing-tiers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKU_PREFIX = "UG";

/** Lower bound on batch numbers — first batch is B0001. */
const MIN_BATCH_NUMBER = 1;

/**
 * Upper bound on batch numbers — capped at 9999 per Rene's 2026-04-28
 * 4-digit specification. If we ever cross this, the format upgrades
 * (B[NNNNN] = 5-digit) — that's a doctrine change, not a runtime
 * patch.
 */
const MAX_BATCH_NUMBER = 9999;

/** Number of digits in the batch-number segment. */
const BATCH_NUMBER_WIDTH = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchSkuParts {
  /** Batch number (1..9999). */
  batchNumber: number;
  /**
   * Pickup date as `Date` for the canonical helper, or `YYMMDD`
   * string when re-hydrating from a parsed SKU. The format helper
   * accepts either; the parse helper returns string form (no
   * timezone surprises round-tripping).
   */
  pickupDate: Date | string;
  /** Fulfillment-type code from pricing-tiers.ts. */
  fulfillmentType: FulfillmentType;
}

export interface ParsedBatchSku {
  batchNumber: number;
  /** YYMMDD string as it appeared in the SKU. */
  pickupDate: string;
  fulfillmentType: FulfillmentType;
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Format a batch SKU. Pure.
 *
 * Throws on invalid inputs — defensive: a malformed SKU written
 * to QBO would corrupt the audit trail forever, so we fail-fast.
 *
 * Examples:
 *   formatBatchSku({ batchNumber: 1, pickupDate: new Date("2026-04-15"), fulfillmentType: "MCL" })
 *     → "UG-B0001-260415-MCL"
 *
 *   formatBatchSku({ batchNumber: 47, pickupDate: "260901", fulfillmentType: "PBF" })
 *     → "UG-B0047-260901-PBF"
 */
export function formatBatchSku(parts: BatchSkuParts): string {
  if (!Number.isFinite(parts.batchNumber) || !Number.isInteger(parts.batchNumber)) {
    throw new Error(
      `formatBatchSku: batchNumber must be a positive integer; got ${parts.batchNumber}`,
    );
  }
  if (parts.batchNumber < MIN_BATCH_NUMBER || parts.batchNumber > MAX_BATCH_NUMBER) {
    throw new Error(
      `formatBatchSku: batchNumber must be in [${MIN_BATCH_NUMBER}, ${MAX_BATCH_NUMBER}]; got ${parts.batchNumber}. If we've crossed 9999, upgrade the spec to 5-digit before continuing.`,
    );
  }
  if (!isFulfillmentType(parts.fulfillmentType)) {
    throw new Error(
      `formatBatchSku: invalid fulfillmentType "${parts.fulfillmentType}". Must be one of LCD / MCL / MCBF / PL / PBF.`,
    );
  }

  const batchSegment = `B${String(parts.batchNumber).padStart(BATCH_NUMBER_WIDTH, "0")}`;
  const dateSegment = formatPickupDate(parts.pickupDate);
  return `${SKU_PREFIX}-${batchSegment}-${dateSegment}-${parts.fulfillmentType}`;
}

/**
 * Convert a Date or pre-formatted YYMMDD string into the canonical
 * 6-digit YYMMDD form. Pure. Throws on invalid input.
 *
 * Uses UTC components — sorted chronologically, no timezone surprises.
 * If you need a different timezone for the pickup date, normalize at
 * the call site before passing here.
 */
function formatPickupDate(input: Date | string): string {
  if (typeof input === "string") {
    if (!/^\d{6}$/.test(input)) {
      throw new Error(
        `formatPickupDate: string input must be 6 digits (YYMMDD); got "${input}"`,
      );
    }
    return input;
  }
  if (!(input instanceof Date) || Number.isNaN(input.getTime())) {
    throw new Error(
      `formatPickupDate: invalid Date input; got ${String(input)}`,
    );
  }
  const yy = String(input.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(input.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(input.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse a batch SKU into its component parts. Pure.
 *
 * Returns `null` on any malformed input — never throws (callers
 * often parse SKUs from external systems where malformed data is
 * expected). Use the type guard `isBatchSku()` if you just need a
 * boolean.
 *
 * Examples:
 *   parseBatchSku("UG-B0001-260415-MCL")
 *     → { batchNumber: 1, pickupDate: "260415", fulfillmentType: "MCL" }
 *
 *   parseBatchSku("garbage") → null
 *   parseBatchSku("UG-B999-260415-MCL") → null  (3-digit batch number rejected)
 */
export function parseBatchSku(sku: string): ParsedBatchSku | null {
  if (typeof sku !== "string") return null;
  const m = sku.match(/^UG-B(\d{4})-(\d{6})-([A-Z]{2,4})$/);
  if (!m) return null;
  const batchNumber = Number.parseInt(m[1], 10);
  if (
    !Number.isFinite(batchNumber) ||
    batchNumber < MIN_BATCH_NUMBER ||
    batchNumber > MAX_BATCH_NUMBER
  ) {
    return null;
  }
  const pickupDate = m[2];
  const ft = m[3];
  if (!isFulfillmentType(ft)) return null;
  return {
    batchNumber,
    pickupDate,
    fulfillmentType: ft,
  };
}

/** Type guard: is `sku` a syntactically valid batch SKU? Pure. */
export function isBatchSku(sku: unknown): sku is string {
  return typeof sku === "string" && parseBatchSku(sku) !== null;
}

// ---------------------------------------------------------------------------
// Convenience round-trip
// ---------------------------------------------------------------------------

/**
 * Round-trip a SKU through parse + format. Returns the canonical
 * representation if the input was valid; null otherwise. Used to
 * normalize hand-typed SKUs before persisting (defense against
 * lower-case codes, extra spaces, etc.).
 */
export function canonicalizeBatchSku(sku: string): string | null {
  const parsed = parseBatchSku(sku);
  if (!parsed) return null;
  return formatBatchSku(parsed);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export const __INTERNAL = {
  SKU_PREFIX,
  MIN_BATCH_NUMBER,
  MAX_BATCH_NUMBER,
  BATCH_NUMBER_WIDTH,
  formatPickupDate,
};
