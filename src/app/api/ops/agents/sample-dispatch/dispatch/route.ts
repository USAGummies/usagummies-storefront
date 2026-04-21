/**
 * POST /api/ops/agents/sample-dispatch/dispatch
 *
 * Sample/Order Dispatch Specialist (S-08) event-runtime MVP.
 *
 * Accepts a normalized OrderIntent payload (from any upstream webhook
 * adapter or manual trigger), classifies origin + carrier + service
 * per the canonical rule set, composes a Class B `shipment.create`
 * proposal, and posts it to `#ops-approvals` for Ben's explicit
 * per-instance approval.
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
 *     hubspot?: { dealId?: string, arHold?: boolean }
 *   }
 *
 *   plus:
 *     post?: boolean     — default true. When false, return proposal
 *                          without posting (useful for UI preview).
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
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

  // Hard refuse — DO NOT post a shipment.create proposal; instead escalate.
  if (classification.refuse) {
    if (shouldPost) {
      // Route the refusal to #ops-alerts so Ben + Rene see it immediately.
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

  // Happy path: post the Class B proposal to #ops-approvals.
  let posted = false;
  let postedTo: string | null = null;
  if (shouldPost) {
    const approvals = getChannel("ops-approvals");
    if (!approvals) {
      degraded.push("slack-approvals: #ops-approvals channel not registered");
    } else {
      try {
        const res = await postMessage({
          channel: approvals.name,
          text: proposal.renderedMarkdown,
        });
        if (res.ok) {
          posted = true;
          postedTo = approvals.name;
        } else {
          degraded.push("slack-approvals-post: not ok");
        }
      } catch (err) {
        degraded.push(
          `slack-approvals-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    posted,
    postedTo,
    classification,
    proposal,
    degraded,
  });
}
