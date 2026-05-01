/**
 * Escalation-clause variants per `/contracts/pricing-route-governance.md` §6.
 *
 * Required on every booth quote (R7). Variants:
 *   - Reorder protection (anchor account): N=3 pallets, M=90 days
 *   - Landed delivery offer: N=1 pallet, M=30 days
 *   - Strategic / sample / show special: "this order only"
 *
 * 2026-04-30 PM (Phase 36.5) — the canonical clause strings + dispatch
 * logic moved to `src/lib/finance/escalation-language.ts` so the same
 * source-of-truth is shared with AP-packet templates + QBO invoice
 * customerMemo. This file stays as the booth-quote-specific entry
 * point so existing imports keep working — it now thin-wraps the
 * canonical dispatch (the strings live in one place; tests pin them
 * there).
 */
import { pickEscalationClause } from "@/lib/finance/escalation-language";

import type { ApprovalRequirement, PricingClass } from "./booth-visit-types";

/** Pick the right clause variant for a given quote shape. */
export function escalationClauseFor(args: {
  pricingClass: PricingClass;
  approval: ApprovalRequirement;
  totalBags: number;
}): string {
  return pickEscalationClause({
    pricingClass: args.pricingClass,
    approval: args.approval,
    totalBags: args.totalBags,
  }).text;
}
