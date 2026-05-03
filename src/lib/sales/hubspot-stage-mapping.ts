/**
 * Map HubSpot's B2B Wholesale pipeline stage ids to canonical
 * PIPELINE_STAGES. Pure data — adding a stage on the HubSpot side
 * means adding a row here.
 *
 * The mapping is intentionally **lossy** (HubSpot has 1 stage for
 * "Quote/PO Sent" but our canonical model splits Quote Sent / PO
 * Received). When the canonical model is more granular, we map the
 * HubSpot id → the **conservative** canonical stage (the earlier one)
 * so the verifier never reports a HubSpot stage as more advanced than
 * what the operator actually clicked. The verifier's drift detection
 * still catches the case where evidence runs ahead of the HubSpot
 * claim.
 */
import type { PipelineStage } from "./pipeline-evidence";

// HubSpot stage IDs — copied from src/lib/ops/hubspot-client.ts.
// Keep in sync if HubSpot's pipeline schema changes.
export const HUBSPOT_STAGE_INTEREST = "appointmentscheduled";
export const HUBSPOT_STAGE_SAMPLE_REQUESTED = "3017718463";
export const HUBSPOT_STAGE_SAMPLE_SHIPPED = "3017718464";
export const HUBSPOT_STAGE_QUOTE_PO_SENT = "3017718465";
export const HUBSPOT_STAGE_VENDOR_SETUP = "3502336729";
export const HUBSPOT_STAGE_PO_RECEIVED = "3017718466";
export const HUBSPOT_STAGE_SHIPPED = "3017718460";
export const HUBSPOT_STAGE_REORDER = "3485080311";
export const HUBSPOT_STAGE_CLOSED_WON = "3502336730";

/**
 * Map: HubSpot stage id → canonical pipeline stage.
 *
 * Conservative mapping policy:
 *   - "Quote/PO Sent" maps to `quote_sent` (the earlier of the two
 *     possibilities). If the deal actually has a PO, the verifier
 *     will surface `po_received` from evidence and the operator
 *     advances HubSpot manually.
 *   - "Closed Won" → `paid` (most conservative; if the operator has
 *     also marked it Shipped, the next stage advances itself).
 *   - "Reorder" → `reordered` (terminal — assumes the second order
 *     evidence is on file, which the verifier double-checks).
 */
export const HUBSPOT_TO_CANONICAL: Record<string, PipelineStage> = {
  [HUBSPOT_STAGE_INTEREST]: "interested",
  [HUBSPOT_STAGE_SAMPLE_REQUESTED]: "sample_requested",
  [HUBSPOT_STAGE_SAMPLE_SHIPPED]: "sample_shipped",
  [HUBSPOT_STAGE_QUOTE_PO_SENT]: "quote_sent",
  [HUBSPOT_STAGE_VENDOR_SETUP]: "vendor_setup",
  [HUBSPOT_STAGE_PO_RECEIVED]: "po_received",
  [HUBSPOT_STAGE_SHIPPED]: "shipped",
  [HUBSPOT_STAGE_REORDER]: "reordered",
  [HUBSPOT_STAGE_CLOSED_WON]: "paid",
};

/**
 * Translate a HubSpot stage id to a canonical pipeline stage. Returns
 * null when the stage is unknown (e.g. a stage we haven't mapped yet,
 * or a closed_lost stage that isn't tracked in the canonical model).
 */
export function canonicalStageFromHubspot(
  hubspotStage: string | null | undefined,
): PipelineStage | null {
  if (!hubspotStage) return null;
  return HUBSPOT_TO_CANONICAL[hubspotStage] ?? null;
}
