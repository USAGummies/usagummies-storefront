/**
 * Pure quote composer — `BoothVisitIntent` → `BoothQuote`.
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` §7 (architecture).
 * No I/O. The Slack post + KV write happen in the API route.
 */
import { BAGS_PER_UNIT } from "@/lib/wholesale/pricing-tiers";

import type { BoothQuote, BoothVisitIntent } from "./booth-visit-types";
import { classifyBoothTier } from "./classify-booth-tier";
import { escalationClauseFor } from "./escalation-clause";
import { freightForCorridor } from "./freight-corridor-table";

/** May 2026 trip ID — see `/contracts/sales-tour-may-2026-prospect-list.md`. */
export const DEFAULT_TOUR_ID = "may-2026" as const;

/**
 * Build a stable visit ID from the prospect name + a timestamp. Same prospect
 * + same minute = same id (idempotency window). Sanitizes prospect name to
 * a safe slug for KV keys.
 */
export function buildVisitId(prospectName: string | null, generatedAt: Date): string {
  const slug = (prospectName ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "unknown";
  // Truncate timestamp to the minute so retries within 60s are idempotent.
  const minute = new Date(
    Math.floor(generatedAt.getTime() / 60000) * 60000,
  ).toISOString();
  return `${slug}-${minute.slice(0, 16).replace(/[:T]/g, "-")}`;
}

/** Compose the structured quote payload from a parsed booth intent. */
export function composeBoothQuote(
  intent: BoothVisitIntent,
  opts: { tourId?: string; now?: Date } = {},
): BoothQuote {
  const tourId = opts.tourId ?? DEFAULT_TOUR_ID;
  const now = opts.now ?? new Date();

  const classification = classifyBoothTier(intent);

  // Pallet count for freight lookup. Sub-pallet orders → no corridor freight
  // (USPS/UPS rates from existing auto-ship pipeline cover those).
  const palletCount =
    intent.scale === "pallet"
      ? intent.count
      : Math.floor(intent.totalBags / BAGS_PER_UNIT.B4);

  const freight = freightForCorridor(intent.state, palletCount);

  const escalationClause = escalationClauseFor({
    pricingClass: classification.pricingClass,
    approval: classification.approval,
    totalBags: intent.totalBags,
  });

  return {
    intent,
    lines: classification.lines,
    freight,
    escalationClause,
    approval: classification.approval,
    approvalReasons: classification.approvalReasons,
    dealCheckRequired: classification.dealCheckRequired,
    tourId,
    visitId: buildVisitId(intent.prospectName, now),
    generatedAt: now.toISOString(),
  };
}
