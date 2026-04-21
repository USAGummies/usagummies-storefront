/**
 * Delivered-Pricing Guard — USA Gummies
 *
 * BUILD #7 — enforce the "delivered" pricing doctrine.
 *
 * Context: `/contracts/distributor-pricing-commitments.md` §6 lists
 * "Do NOT add a freight line to a 'delivered' distributor's invoice"
 * as a prohibited action. A future agent — or a mis-configured
 * operator — could still try to do exactly that. This module is the
 * code-level backstop.
 *
 * Usage — always wrap a QBO invoice / sales-receipt write with the
 * guard. Agents that hit a guard rejection must escalate as a Class C
 * approval (Ben + Rene) rather than work around it.
 *
 *   const check = validateInvoiceAgainstPricingDoctrine({
 *     customer: "Glacier Wholesalers",
 *     hasFreightLine: true,
 *     freightAmount: 32.18,
 *   });
 *   if (!check.ok) throw new Error(check.error);
 *   // ...proceed to createQBOInvoice()
 */

// ---------------------------------------------------------------------------
// Delivered-pricing customer registry
// ---------------------------------------------------------------------------

/**
 * Customers on delivered pricing (freight absorbed). Sourced from
 * `/contracts/distributor-pricing-commitments.md` — keep in sync.
 *
 * Matching is case-insensitive + substring: "Glacier" matches
 * "Glacier Wholesalers, Inc.", "Glacier Wholesalers", etc.
 */
export const DELIVERED_PRICING_CUSTOMERS: Array<{
  match: string; // lowercase substring
  tier: "sell_sheet_249" | "option_b_210" | "option_a_250" | "show_special_325";
  terms: string;
  freightAbsorbed: true;
  source: string; // contract reference
}> = [
  {
    match: "inderbitzin",
    tier: "option_b_210",
    terms: "$2.10/bag delivered, Option B loose bags",
    freightAbsorbed: true,
    source: "/contracts/distributor-pricing-commitments.md §2",
  },
  {
    match: "glacier",
    tier: "option_b_210",
    terms: "$2.10/bag delivered, Option B loose bags",
    freightAbsorbed: true,
    source: "/contracts/distributor-pricing-commitments.md §2",
  },
  {
    match: "bryce glamp",
    tier: "show_special_325",
    terms: "$3.25/bag, Reunion 2026 FREE shipping show-special",
    freightAbsorbed: true,
    source: "/contracts/distributor-pricing-commitments.md §3",
  },
  {
    match: "reunion 2026",
    tier: "show_special_325",
    terms: "$3.25/bag, Reunion 2026 FREE shipping show-special",
    freightAbsorbed: true,
    source: "/contracts/distributor-pricing-commitments.md §3",
  },
];

export interface DeliveredPricingMatch {
  match: string;
  tier: string;
  terms: string;
  freightAbsorbed: boolean;
  source: string;
}

/**
 * Look up whether a given customer name is on delivered pricing.
 * Returns the matched registry entry, or null if no match.
 */
export function lookupDeliveredPricing(
  customerName: string | null | undefined,
): DeliveredPricingMatch | null {
  if (!customerName) return null;
  const needle = customerName.toLowerCase();
  const entry = DELIVERED_PRICING_CUSTOMERS.find((c) => needle.includes(c.match));
  return entry ? { ...entry } : null;
}

// ---------------------------------------------------------------------------
// Invoice / sales-receipt validator
// ---------------------------------------------------------------------------

export interface ValidateInvoiceParams {
  /** Display name of the customer / distributor on the invoice. */
  customer: string;
  /** Whether the invoice line-item set includes a freight / shipping line. */
  hasFreightLine: boolean;
  /** Dollar amount of any freight line on the invoice (for error context). */
  freightAmount?: number;
  /** Override — only set when Class C approval has been granted in writing. */
  overrideApprovedBy?: {
    approver: "Ben" | "Rene";
    reason: string;
    documentedAt: string; // ISO timestamp
  };
}

export type ValidateInvoiceResult =
  | { ok: true; match: DeliveredPricingMatch | null }
  | { ok: false; error: string; match: DeliveredPricingMatch };

/**
 * Refuse to bill freight to a customer on delivered pricing unless a
 * Class C override has been explicitly documented.
 *
 * This is a *code* guard — the Contract is the *policy* source.
 * Agents that hit this error should escalate via the approval
 * taxonomy, not work around it.
 */
export function validateInvoiceAgainstPricingDoctrine(
  params: ValidateInvoiceParams,
): ValidateInvoiceResult {
  const match = lookupDeliveredPricing(params.customer);
  if (!match) {
    // Not a delivered-pricing customer — any freight line is fine.
    return { ok: true, match: null };
  }

  if (!params.hasFreightLine) {
    // Delivered pricing customer, and we correctly OMITTED freight. Good.
    return { ok: true, match };
  }

  // Delivered pricing + freight line present. Override?
  if (params.overrideApprovedBy) {
    const o = params.overrideApprovedBy;
    if (
      (o.approver === "Ben" || o.approver === "Rene") &&
      typeof o.reason === "string" &&
      o.reason.trim().length >= 8 &&
      typeof o.documentedAt === "string"
    ) {
      return { ok: true, match };
    }
    return {
      ok: false,
      match,
      error:
        `Freight override rejected for ${params.customer}: override.reason must be >= 8 chars ` +
        `and approver must be 'Ben' or 'Rene'. See ${match.source}.`,
    };
  }

  // No override → refuse.
  const amt =
    typeof params.freightAmount === "number"
      ? ` ($${params.freightAmount.toFixed(2)})`
      : "";
  return {
    ok: false,
    match,
    error:
      `Pricing doctrine violation: ${params.customer} is on delivered pricing ` +
      `(${match.terms}) — freight is absorbed by USA Gummies. ` +
      `Invoice includes a freight line${amt} which breaches the quote. ` +
      `If this is an intentional renegotiation, set \`overrideApprovedBy\` with ` +
      `Class C approval from Ben or Rene and a written reason. Source: ${match.source}.`,
  };
}

// ---------------------------------------------------------------------------
// Friendlier assert() wrapper for one-line use in routes
// ---------------------------------------------------------------------------

/**
 * Throws on violation. Use inside route handlers / agent scripts where
 * the caller wants to bail out immediately:
 *
 *   assertDeliveredPricingCompliant({ customer: "Glacier", hasFreightLine: true });
 */
export function assertDeliveredPricingCompliant(
  params: ValidateInvoiceParams,
): void {
  const res = validateInvoiceAgainstPricingDoctrine(params);
  if (!res.ok) throw new Error(res.error);
}
