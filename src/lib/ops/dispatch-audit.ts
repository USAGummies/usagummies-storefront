/**
 * Dispatch Audit Mirror — shared helper for every S-08 dispatch path.
 *
 * Per /contracts/governance.md §6 + Research Blueprint §6 non-
 * negotiable: "Every autonomous write is logged to #ops-audit".
 * Each dispatch route (webhook adapter, UI bridge, Slack trigger)
 * must mirror its classification + post result to the audit store
 * AND the #ops-audit Slack surface.
 *
 * Writes one AuditLogEntry per dispatch attempt with:
 *   - actorId = the caller's agentId (e.g. "sample-order-dispatch",
 *     "shopify-webhook-adapter")
 *   - action = "shipment.proposal.post" (happy path) OR
 *     "shipment.proposal.refuse" (classifier refusal) OR
 *     "shipment.proposal.post.failed" (slack/write failure)
 *   - entityType = "shipment.proposal"
 *   - entityId = `<channel>:<sourceId>`
 *   - sourceCitations = upstream ids (HubSpot deal id, Shopify order,
 *     Amazon order, etc.)
 *
 * Failure to audit is logged but never breaks the dispatch response —
 * governance treats storage as authoritative, Slack mirror as
 * best-effort.
 */

import { auditSurface } from "./control-plane/slack";
import { auditStore } from "./control-plane/stores";
import { buildAuditEntry } from "./control-plane/audit";
import { newRunContext } from "./control-plane/run-id";
import type { DivisionId } from "./control-plane/types";
import type {
  DispatchChannel,
  DispatchClassification,
  ShipmentProposal,
} from "./sample-order-dispatch";

export type DispatchAuditAction =
  | "shipment.proposal.post"
  | "shipment.proposal.post.failed"
  | "shipment.proposal.refuse"
  | "shipment.proposal.retry-enqueue";

export interface AuditDispatchParams {
  /** Agent doing the dispatch. Matches contract agent_id. */
  agentId: string;
  division: DivisionId;
  /** Stable run id — mint a fresh one per dispatch event. */
  runId?: string;
  /** Upstream channel — "shopify" / "amazon" / etc. */
  channel: DispatchChannel;
  sourceId: string;
  orderNumber?: string;
  classification: DispatchClassification;
  proposal: ShipmentProposal;
  /** What happened. */
  action: DispatchAuditAction;
  /** Slack ts returned by chat.postMessage when the proposal was posted. */
  proposalTs?: string | null;
  /** Slack channel the proposal landed in (usually #ops-approvals). */
  postedToChannel?: string | null;
  /** Present on refuse paths. */
  refuseReason?: string;
  /** Present on failure paths. */
  error?: string;
}

export async function auditDispatch(params: AuditDispatchParams): Promise<void> {
  try {
    const run = params.runId
      ? {
          runId: params.runId,
          agentId: params.agentId,
          division: params.division,
          startedAt: new Date().toISOString(),
          source: "event" as const,
          trigger: `${params.channel}:${params.action}`,
        }
      : newRunContext({
          agentId: params.agentId,
          division: params.division,
          source: "event",
          trigger: `${params.channel}:${params.action}`,
        });

    const entityId = `${params.channel}:${params.sourceId}`;
    const result =
      params.action === "shipment.proposal.post"
        ? ("ok" as const)
        : params.action === "shipment.proposal.refuse"
          ? ("skipped" as const)
          : ("error" as const);

    const sourceCitations = [
      {
        system: params.channel,
        id: params.sourceId,
        ...(params.orderNumber ? { url: `order:${params.orderNumber}` } : {}),
      },
    ];

    const entry = buildAuditEntry(run, {
      action: params.action,
      entityType: "shipment.proposal",
      entityId,
      after: {
        classification: {
          origin: params.classification.origin,
          carrierCode: params.classification.carrierCode,
          serviceCode: params.classification.serviceCode,
          packagingType: params.classification.packagingType,
          cartons: params.classification.cartons,
          warningsCount: params.classification.warnings.length,
          refuse: params.classification.refuse,
        },
        proposalSummary: params.proposal.summary,
        proposalTs: params.proposalTs ?? null,
        postedToChannel: params.postedToChannel ?? null,
        refuseReason: params.refuseReason,
      },
      result,
      sourceCitations,
      confidence: 1,
      error: params.error ? { message: params.error } : undefined,
    });

    await auditStore().append(entry);
    try {
      await auditSurface().mirror(entry);
    } catch {
      // Slack mirror is best-effort — storage is authoritative.
    }
  } catch (err) {
    // Audit failure never breaks dispatch. Log + move on.
    console.error(
      "[dispatch-audit] audit write failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
