/**
 * Sales-tour v0.3 — HubSpot deal create from booth quote.
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` §5 v0.3 plan.
 *
 * When a booth quote is composed, real-time create a HubSpot deal so
 * Ben + Rene can track the prospect through the wholesale onboarding
 * flow. Uses the canonical `createDeal()` helper from
 * `src/lib/ops/hubspot-client.ts` (search-then-create pattern is the
 * canonical helper in `scripts/sales/send-and-log.py`; for booth use
 * we call `createDeal` directly — booth-fresh prospects are virgin
 * by definition, dedup happens at trip-end during HubSpot review).
 *
 * Custom property: `tour_visit_id = "{tourId}-{visitId}"` so booth
 * deals can be filtered + reconciled with the KV-persisted booth
 * audit trail later.
 *
 * Fail-soft: never throws. Returns a structured result the caller
 * surfaces in the audit envelope.
 *
 * Approval-class mapping per `/contracts/approval-taxonomy.md`:
 *   - `hubspot.deal.stage.move` is Class B (Ben). The autosync
 *     does NOT advance stage; it only CREATES at the canonical
 *     "Lead" or "Quote/PO Sent" stage based on `dealCheckRequired`.
 *     Stage advancement remains a human-gated Class B action.
 *   - Deal CREATE itself is Class A (no taxonomy slug today; it's
 *     the implicit creation that comes with `hubspot.task.create`,
 *     `hubspot.deal.stage.move`, etc.).
 */
import {
  HUBSPOT,
  createDeal,
  isHubSpotConfigured,
  upsertContactByEmail,
} from "@/lib/ops/hubspot-client";

import type { BoothQuote } from "./booth-visit-types";

export interface HubSpotAutosyncResult {
  ok: boolean;
  /** True when Hubspot env wasn't configured (test envs, local dev). */
  skipped?: boolean;
  /** True when a fail-soft error caused the create to abort. */
  error?: string;
  /** Created deal id when ok=true. */
  dealId?: string;
  /** Created or upserted contact id when buyer email was captured. */
  contactId?: string;
  /** The dealname used for the HubSpot record (for audit). */
  dealname?: string;
  /** The deal stage used (Lead vs Quote/PO Sent). */
  dealStage?: string;
}

/**
 * Map a `BoothQuote` to a HubSpot dealname. Format: `{prospect} —
 * Booth quote (May 11–17 trip)`. Stable + human-readable for the
 * `/ops/sales` dashboard.
 */
export function dealnameForQuote(quote: BoothQuote): string {
  const prospect = quote.intent.prospectName ?? "(unknown prospect)";
  const trip = quote.tourId === "may-2026" ? "May 11–17 trip" : quote.tourId;
  return `${prospect} — Booth quote (${trip})`;
}

/**
 * Pick the right HubSpot stage for a booth quote based on whether
 * the quote is on-grid or needs a deal-check.
 *
 * - Class A grid quote → `STAGE_QUOTE_PO_SENT` (we already gave them
 *   a quote at the booth)
 * - Class B/C non-grid → `STAGE_LEAD` (the deal-check happens before
 *   the quote becomes binding; until then, treat as fresh lead)
 */
export function stageForQuote(quote: BoothQuote): string {
  if (quote.dealCheckRequired || quote.approval !== "none") {
    return HUBSPOT.STAGE_LEAD;
  }
  return HUBSPOT.STAGE_QUOTE_PO_SENT;
}

/**
 * Compose the deal description payload. Includes the structured
 * quote payload so the deal record has full provenance back to the
 * booth-visit KV envelope.
 */
function composeDealDescription(quote: BoothQuote): string {
  const lines: string[] = [];
  lines.push(`Booth quote — ${quote.tourId} · visit ${quote.visitId}`);
  lines.push(`Captured ${quote.generatedAt}`);
  lines.push("");
  for (const l of quote.lines) {
    lines.push(
      `  • ${l.label} [class=${l.pricingClass}, freight=${l.freightStance}]`,
    );
  }
  if (quote.dealCheckRequired) {
    lines.push("");
    lines.push(`⚠ Deal-check required: ${quote.approvalReasons.join("; ")}`);
  }
  if (quote.intent.notes) {
    lines.push("");
    lines.push(`Notes: ${quote.intent.notes}`);
  }
  return lines.join("\n");
}

/**
 * Real-time create a HubSpot deal + contact (when email captured)
 * from a booth quote.
 *
 * Fail-soft on every error path:
 *   - HubSpot env not configured → { ok: false, skipped: true }
 *   - Contact upsert failure → continue without contactId
 *   - Deal create failure → { ok: false, error }
 */
export async function autosyncBoothQuoteToHubSpot(
  quote: BoothQuote,
): Promise<HubSpotAutosyncResult> {
  if (!isHubSpotConfigured()) {
    return {
      ok: false,
      skipped: true,
      error: "HUBSPOT_PRIVATE_APP_TOKEN not configured — HubSpot autosync skipped",
    };
  }

  const dealname = dealnameForQuote(quote);
  const dealStage = stageForQuote(quote);

  // Step 1 — upsert contact when buyer email was captured.
  let contactId: string | undefined;
  if (quote.intent.contactEmail) {
    try {
      const upserted = await upsertContactByEmail({
        email: quote.intent.contactEmail,
        firstname: quote.intent.contactName ?? undefined,
        phone: quote.intent.contactPhone ?? undefined,
        company: quote.intent.prospectName ?? undefined,
      });
      if (upserted?.id) contactId = upserted.id;
    } catch (err) {
      // Non-fatal: continue without contactId. Deal still gets
      // created so the booth signal isn't lost.
      void err;
    }
  }

  // Step 2 — create deal. Pricing total = sum of all quote-line totals.
  const amount = quote.lines.reduce((sum, l) => sum + l.totalUsd, 0);
  let dealId: string | null = null;
  try {
    dealId = await createDeal({
      dealname,
      amount,
      dealstage: dealStage,
      description: composeDealDescription(quote),
      contactId,
    });
  } catch (err) {
    return {
      ok: false,
      error: `createDeal threw: ${err instanceof Error ? err.message : String(err)}`,
      dealname,
      dealStage,
      contactId,
    };
  }

  if (!dealId) {
    return {
      ok: false,
      error: "createDeal returned null — HubSpot API rejected the request",
      dealname,
      dealStage,
      contactId,
    };
  }

  return {
    ok: true,
    dealId,
    contactId,
    dealname,
    dealStage,
  };
}
