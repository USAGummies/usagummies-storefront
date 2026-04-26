/**
 * POST /api/ops/agents/sample-dispatch/dispatch
 *
 * Sample/Order Dispatch Specialist (S-08) event-runtime.
 *
 * Accepts a normalized OrderIntent payload (from any upstream webhook
 * adapter or manual trigger), classifies origin + carrier + service per
 * the canonical rule set, and opens a true Class B `shipment.create`
 * approval via the canonical control plane (`requestApproval()`).
 *
 * What this route DOES:
 *   1. Validates structural fields (channel, sourceId, shipTo with the
 *      five required address fields). Any missing field → 400 (no
 *      invented data — hard-rules §7).
 *   2. Runs `classifyDispatch()` for origin / carrier / service.
 *   3. On hard refusals (ar_hold, etc.) audits + posts to #ops-alerts
 *      and returns 422. NO approval is opened — refusal is terminal.
 *   4. On the happy path, opens a Class B `shipment.create` approval
 *      through `requestApproval()`. The approval surface posts the card
 *      to #ops-approvals with Approve / Reject / Ask buttons. The
 *      approval's id (and slack ts) are returned to the caller.
 *
 * What this route DOES NOT do:
 *   - Buy a label.  Label purchase only happens via the approved-action
 *     closer in /api/slack/approvals AFTER a human approves.
 *   - Invent ship-to fields.  Caller (e.g. email-intel orchestrator)
 *     must supply a fully-parsed address or skip the dispatch and ask.
 *
 * Contract: /contracts/agents/sample-order-dispatch.md
 *
 * Body:
 *   {
 *     channel: "shopify" | "amazon" | "faire" | "hubspot" | "manual",
 *     sourceId: string,
 *     orderNumber?: string,
 *     valueUsd?: number,
 *     tags?: string[],
 *     note?: string,
 *     shipTo: {...},
 *     packagingType?: "case" | "master_carton",
 *     cartons?: number,
 *     weightLbs?: number,
 *     hubspot?: { dealId?: string, arHold?: boolean },
 *     post?: boolean              // default true. When false, skip
 *                                 // approval surfacing (UI preview).
 *   }
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { requestApproval } from "@/lib/ops/control-plane/record";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { auditDispatch } from "@/lib/ops/dispatch-audit";
import {
  classifyDispatch,
  composeShipmentProposal,
  type OrderIntent,
} from "@/lib/ops/sample-order-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: OrderIntent & { post?: boolean };
  try {
    body = (await req.json()) as OrderIntent & { post?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Minimal structural validation. Classifier handles soft issues via warnings.
  if (!body.channel) {
    return NextResponse.json({ error: "channel required" }, { status: 400 });
  }
  if (!body.sourceId) {
    return NextResponse.json({ error: "sourceId required" }, { status: 400 });
  }
  if (!body.shipTo || typeof body.shipTo !== "object") {
    return NextResponse.json({ error: "shipTo required" }, { status: 400 });
  }
  const required: Array<keyof typeof body.shipTo> = [
    "name",
    "street1",
    "city",
    "state",
    "postalCode",
  ];
  for (const k of required) {
    if (!body.shipTo[k] || String(body.shipTo[k]).trim().length === 0) {
      return NextResponse.json(
        { error: `shipTo.${k as string} required` },
        { status: 400 },
      );
    }
  }

  const classification = classifyDispatch(body);
  const proposal = composeShipmentProposal(body, classification);
  const shouldPost = body.post !== false;
  const degraded: string[] = [];

  // ---- Hard refuse path ---------------------------------------------------
  // DO NOT open an approval; instead, alert + audit and return 422. A refusal
  // is terminal — humans handle the AR hold or whatever blocked it.
  if (classification.refuse) {
    if (shouldPost) {
      const alerts = getChannel("ops-alerts");
      if (alerts) {
        try {
          await postMessage({
            channel: alerts.name,
            text:
              `:no_entry: *Dispatch refused — ${body.channel}:${body.orderNumber ?? body.sourceId}*\n` +
              `${classification.refuseReason}\n` +
              `Ship-to: ${body.shipTo.name} · ${body.shipTo.city}, ${body.shipTo.state}`,
          });
        } catch (err) {
          degraded.push(
            `slack-alerts-post: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        degraded.push("slack-alerts: #ops-alerts channel not registered");
      }
    }
    await auditDispatch({
      agentId: "sample-order-dispatch",
      division: "production-supply-chain",
      channel: body.channel,
      sourceId: body.sourceId,
      orderNumber: body.orderNumber,
      classification,
      proposal,
      action: "shipment.proposal.refuse",
      refuseReason: classification.refuseReason,
    });
    return NextResponse.json(
      {
        ok: false,
        refuse: true,
        refuseReason: classification.refuseReason,
        classification,
        degraded,
      },
      { status: 422 },
    );
  }

  // ---- Happy path: canonical Class B approval -----------------------------
  // We open the approval via requestApproval() so the control plane
  // - persists an ApprovalRequest with id, status "pending", required
  //   approvers, escalate/expire timestamps;
  // - mirrors an `approval.open:shipment.create` audit entry to #ops-audit;
  // - lets the approval surface render the buttons in #ops-approvals.
  //
  // The label is NOT purchased here. Buying happens only after a human
  // clicks Approve in Slack and the click handler routes the approved
  // shipment.create to its closer.
  let approvalId: string | null = null;
  let approvalTs: string | null = null;
  let approvalErr: string | null = null;

  if (shouldPost) {
    try {
      const isSampleByTag =
        Array.isArray(body.tags) && body.tags.some((t) => /sample/i.test(String(t)));
      const run = newRunContext({
        agentId: "sample-order-dispatch",
        division: "production-supply-chain",
        source: "event",
        trigger: `dispatch:${body.channel}:${body.sourceId}`,
      });
      const evidenceClaim =
        `Ship ${classification.cartons}× ${classification.packagingType} ` +
        `${isSampleByTag ? "sample " : ""}via ${classification.carrierCode}/${classification.serviceCode} ` +
        `to ${body.shipTo.name} (${body.shipTo.city}, ${body.shipTo.state} ${body.shipTo.postalCode}) ` +
        `from origin=${classification.origin}.`;
      const rollbackPlan =
        "Cancel ShipStation order before label purchase; reverse any captured payment via Shopify/Amazon admin. " +
        "No label is bought before approval — rollback is just dropping the pending approval.";

      const approval = await requestApproval(run, {
        actionSlug: "shipment.create",
        targetSystem: "shipstation",
        targetEntity: {
          type: "shipment",
          id: body.sourceId,
          label: body.orderNumber ?? body.sourceId,
        },
        payloadPreview: proposal.renderedMarkdown,
        payloadRef: `dispatch:${body.channel}:${body.sourceId}`,
        evidence: {
          claim: evidenceClaim,
          sources: [
            {
              system: body.channel,
              id: body.sourceId,
              retrievedAt: new Date().toISOString(),
            },
          ],
          confidence: classification.warnings.length === 0 ? 0.9 : 0.7,
        },
        rollbackPlan,
      });
      approvalId = approval.id;
      approvalTs = approval.slackThread?.ts ?? null;
    } catch (err) {
      approvalErr = err instanceof Error ? err.message : String(err);
      degraded.push(`approval-open: ${approvalErr}`);
    }
  }

  await auditDispatch({
    agentId: "sample-order-dispatch",
    division: "production-supply-chain",
    channel: body.channel,
    sourceId: body.sourceId,
    orderNumber: body.orderNumber,
    classification,
    proposal,
    action: approvalId
      ? "shipment.proposal.post"
      : "shipment.proposal.post.failed",
    proposalTs: approvalTs,
    postedToChannel: approvalId ? "#ops-approvals" : null,
    error: approvalErr ?? undefined,
  });

  return NextResponse.json({
    ok: approvalErr === null,
    posted: approvalId !== null,
    postedTo: approvalId ? "#ops-approvals" : null,
    approvalId,
    proposalTs: approvalTs,
    classification,
    proposal,
    degraded,
  });
}
