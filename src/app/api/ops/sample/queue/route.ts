/**
 * POST /api/ops/sample/queue
 *
 * Operator-facing wrapper around `/api/ops/agents/sample-dispatch/dispatch`.
 *
 * The full dispatch endpoint expects a normalized `OrderIntent` with
 * upstream `channel`, `sourceId`, optional HubSpot metadata, and a
 * structured `shipTo` block (5 required fields). That shape is right
 * for webhook adapters; it's wrong for "Ben at his desk wants to send
 * a sample bag to a buyer he just talked to."
 *
 * This route accepts a lean shape:
 *
 *   {
 *     recipient: {
 *       name:       "Greg Kroetch",
 *       company?:   "Powers Confections",
 *       street1:    "123 Main St",
 *       street2?:   "Suite 200",
 *       city:       "Spokane",
 *       state:      "WA",
 *       postalCode: "99201",
 *       phone?:     "+1-555-555-5555"
 *     },
 *     role?:        "buyer" | "broker" | "distributor" | "media" | "other",
 *     quantity?:    number,         // bags; default 6 (one case)
 *     note?:        string,
 *     post?:        boolean         // default true
 *   }
 *
 * Internally:
 *   - Generates a manual `sourceId` (`sample-queue-{timestamp}-{rand}`)
 *   - Sets channel = "manual", tags = ["sample", "tag:sample"]
 *   - Forwards to `classifyDispatch` + `requestApproval` exactly the
 *     same way `/dispatch` does. The Slack approval card lands in
 *     #ops-approvals with the same buttons.
 *   - Detects whale accounts (Buc-ee's, KeHE, McLane, Eastern National,
 *     Xanterra) by recipient/company name and sets `priority: "whale"`
 *     in the response so the operator surface (and audit) can flag the
 *     drop as high-stakes — the approval class is already Class B from
 *     `requestApproval`, but the whale flag adds context.
 *
 * Auth: session OR bearer CRON_SECRET (mirrors /dispatch).
 *
 * Contract: /contracts/agents/sample-order-dispatch.md
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

import {
  buildSampleQueueOrderIntent,
  detectSampleWhalePriority,
  validateSampleQueueRequest,
  type SampleQueueRequest,
} from "@/lib/ops/sample-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SampleQueueRequest;
  try {
    body = (await req.json()) as SampleQueueRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateSampleQueueRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const orderIntent: OrderIntent = buildSampleQueueOrderIntent(body);
  const priority = detectSampleWhalePriority(body);
  const classification = classifyDispatch(orderIntent);
  const proposal = composeShipmentProposal(orderIntent, classification);
  const shouldPost = body.post !== false;
  const degraded: string[] = [];

  // ---- Hard refuse path (mirrors /dispatch) -------------------------------
  if (classification.refuse) {
    if (shouldPost) {
      const alerts = getChannel("ops-alerts");
      if (alerts) {
        try {
          await postMessage({
            channel: alerts.name,
            text:
              `:no_entry: *Sample-queue dispatch refused — ${orderIntent.sourceId}*\n` +
              `${classification.refuseReason}\n` +
              `Recipient: ${orderIntent.shipTo.name} · ${orderIntent.shipTo.city}, ${orderIntent.shipTo.state}`,
          });
        } catch (err) {
          degraded.push(
            `slack-alerts-post: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    await auditDispatch({
      agentId: "sample-queue",
      division: "production-supply-chain",
      channel: orderIntent.channel,
      sourceId: orderIntent.sourceId,
      orderNumber: orderIntent.orderNumber,
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
        priority,
        classification,
        degraded,
      },
      { status: 422 },
    );
  }

  // ---- Happy path: open Class B approval ----------------------------------
  let approvalId: string | null = null;
  let approvalTs: string | null = null;
  let approvalErr: string | null = null;

  if (shouldPost) {
    try {
      const run = newRunContext({
        agentId: "sample-queue",
        division: "production-supply-chain",
        source: "human-invoked",
        trigger: `sample-queue:${orderIntent.sourceId}`,
      });
      const whalePrefix = priority === "whale" ? "WHALE — " : "";
      const evidenceClaim =
        `${whalePrefix}Ship ${classification.cartons}× ${classification.packagingType} ` +
        `sample via ${classification.carrierCode}/${classification.serviceCode} ` +
        `to ${orderIntent.shipTo.name}` +
        (orderIntent.shipTo.company ? ` (${orderIntent.shipTo.company})` : "") +
        ` — ${orderIntent.shipTo.city}, ${orderIntent.shipTo.state} ${orderIntent.shipTo.postalCode}` +
        ` — origin=${classification.origin}.`;
      const rollbackPlan =
        "Cancel ShipStation order before label purchase. No label is bought before Slack approval — rollback is dropping the pending approval.";

      const approval = await requestApproval(run, {
        actionSlug: "shipment.create",
        targetSystem: "shipstation",
        targetEntity: {
          type: "shipment",
          id: orderIntent.sourceId,
          label: `Sample · ${orderIntent.shipTo.name}`,
        },
        payloadPreview: proposal.renderedMarkdown,
        payloadRef: `sample-queue:${orderIntent.sourceId}`,
        evidence: {
          claim: evidenceClaim,
          sources: [
            {
              system: "manual",
              id: orderIntent.sourceId,
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
    agentId: "sample-queue",
    division: "production-supply-chain",
    channel: orderIntent.channel,
    sourceId: orderIntent.sourceId,
    orderNumber: orderIntent.orderNumber,
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
    priority,
    sourceId: orderIntent.sourceId,
    classification,
    proposal,
    degraded,
  });
}
