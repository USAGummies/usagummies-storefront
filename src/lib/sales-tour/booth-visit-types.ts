/**
 * Type definitions for the Sales-Tour booth-visit field workflow (v0.1).
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` v0.1.
 *
 * The flow is: Slack message → `parseBoothVisitMessage` → `BoothVisitIntent`
 * → `composeBoothQuote` → `BoothQuote` → Slack reply. Every type here is
 * pure data; no I/O.
 */

/**
 * Freight ask grammar from `/contracts/sales-tour-field-workflow.md` §2.1.
 *  - `landed`  — buyer wants USA Gummies to absorb freight as bag-price uplift
 *  - `pickup`  — buyer's carrier / buyer comes to pick up
 *  - `anchor`  — buyer wants the route-anchor price ($3.00 landed, ≥3 pallet MOQ)
 *  - `fill`    — buyer is a route-fill stop on an already-justified corridor
 *  - `unsure`  — Ben didn't capture; quote both `landed` + `pickup` so buyer can pick
 */
export type FreightAsk = "landed" | "pickup" | "anchor" | "fill" | "unsure";

/** Two-letter US state code or null when Ben hasn't named one. */
export type StateCode =
  | "WA"
  | "OR"
  | "ID"
  | "MT"
  | "WY"
  | "UT"
  | "NV"
  | "CA"
  | "AZ"
  | "NM"
  | "CO"
  | "TX"
  | "OK"
  | "KS"
  | "NE"
  | "SD"
  | "ND"
  | string; // Permissive — parser may emit other states; quote helpers fail-soft.

/** Quantity scale captured from the booth message. */
export type QuantityScale = "sample" | "case" | "master-carton" | "pallet";

/** Structured intent extracted from a single booth message. */
export interface BoothVisitIntent {
  /** Free-text raw message that Ben sent — kept verbatim for audit. */
  rawText: string;
  /** Prospect company name (the parser's best read). */
  prospectName: string | null;
  /** US state code if named — used for freight corridor lookup. */
  state: StateCode | null;
  /** Optional city if named (currently informational; not used in v0.1 quote). */
  city: string | null;
  /** Quantity scale: sample / case / master-carton / pallet. */
  scale: QuantityScale;
  /** Quantity count at the named scale (e.g. 3 pallets, 8 cases, 1 sample). */
  count: number;
  /** Total bag-equivalent count (count × bags-per-unit). */
  totalBags: number;
  /** Buyer's freight preference. */
  freightAsk: FreightAsk;
  /** Buyer contact name if captured. */
  contactName: string | null;
  /** Buyer phone if captured. */
  contactPhone: string | null;
  /** Buyer email if captured. */
  contactEmail: string | null;
  /** Free-text trailing notes Ben wants to capture (urgency, preferences, etc.). */
  notes: string | null;
  /** Parser confidence in [0,1] — low confidence triggers a "verify with Ben" reply variant. */
  confidence: number;
}

/**
 * Pricing class per `/contracts/pricing-route-governance.md` §1 + the
 * proposal in `/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md`.
 *
 * Maps cleanly to the existing B-grid in `/src/lib/wholesale/pricing-tiers.ts`
 * for the on-grid classes; off-grid (`C-PU`, `C-ANCH`, `C-EXC`) trigger a
 * Class C deal-check post.
 */
export type PricingClass =
  | "C-PU"     // Pickup floor $2.00 (off-grid; Class C first-time)
  | "C-DIST"   // Distributor delivered (off-grid; not used in booth flow)
  | "C-STD"    // Standard wholesale (B2/B3/B4/B5 grid; Class A at grid)
  | "C-ANCH"   // Landed route-anchor $3.00 ≥3 pallets (Class C first-time)
  | "C-FILL"   // Route-fill $3.25–$3.49+ landed (Class A on-route at grid)
  | "C-EXC";   // Strategic credential exception (Class C with deal memo)

/**
 * Class A/B/C/D approval gate for the quote.
 *
 * `none` = the offer matches the published B-grid; agent can quote autonomously.
 * `class-b` = `account.tier-upgrade.propose` (Ben single-approve).
 * `class-c` = `pricing.change` (Ben + Rene dual-approve) — non-grid offers.
 * `class-d` = red-line (e.g. forever pricing); agent refuses.
 */
export type ApprovalRequirement = "none" | "class-b" | "class-c" | "class-d";

/** Pure freight quote: per-pallet drive cost + LTL fallback if Ben can't drive. */
export interface FreightQuote {
  /** Source citation per `R5` (no fabrication). */
  source: "regional-table-v0.1" | "ltl-broker" | "no-freight-needed";
  /** Per-pallet drive cost (founder-drive economics). */
  drivePerPallet: number | null;
  /** Per-pallet LTL fallback (typically 30-50% higher). */
  ltlPerPallet: number | null;
  /** Total trip-leg drive cost for the quote's pallet count. */
  totalDrive: number | null;
  /** Total LTL fallback cost. */
  totalLtl: number | null;
  /** State code looked up. */
  state: StateCode | null;
  /** Whether the corridor row was found. */
  found: boolean;
  /** Per-bag freight cost (drive economics) used for landed-pricing math. */
  driveFreightPerBag: number | null;
}

/** A single quote line — at one B-tier with freight stance. */
export interface QuoteLine {
  /** B-grid designator (`B2`/`B3`/`B4`/`B5`) when this maps cleanly to grid; null for off-grid. */
  bGridDesignator: "B1" | "B2" | "B3" | "B4" | "B5" | null;
  /** Doctrinal class. */
  pricingClass: PricingClass;
  /** Per-bag price quoted (USD). */
  pricePerBag: number;
  /** Freight stance for this line. */
  freightStance: "landed" | "buyer-paid" | "free-on-3-plus-pallet";
  /** Total dollars for this quote line (bags × price). */
  totalUsd: number;
  /** Human-readable line description (Slack-ready). */
  label: string;
}

/** Compiled booth quote — the structured payload that becomes the Slack reply. */
export interface BoothQuote {
  /** Echo of the input intent. */
  intent: BoothVisitIntent;
  /** One or two quote lines (two when freightAsk = "unsure"). */
  lines: QuoteLine[];
  /** Freight quote (when applicable). */
  freight: FreightQuote;
  /** Required escalation clause text per `pricing-route-governance.md` §6. */
  escalationClause: string;
  /** Approval class required to commit this quote. */
  approval: ApprovalRequirement;
  /** Reasons we landed at this approval class (for audit + Slack thread). */
  approvalReasons: string[];
  /** Whether the quote should ALSO emit a Class C deal-check post. */
  dealCheckRequired: boolean;
  /** Trip identifier — defaults to `may-2026` for the May 11–17 trip. */
  tourId: string;
  /** Stable visit ID (deterministic from prospectName+timestamp). */
  visitId: string;
  /** ISO-8601 timestamp for audit. */
  generatedAt: string;
}
