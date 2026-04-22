/**
 * POST /api/ops/amazon/dispatch
 *
 * Amazon FBM dispatch bridge. Ben (or a script) calls this with an
 * Amazon orderId + the ship-to address (copied from Seller Central)
 * and gets a Class B shipment.create proposal in #ops-approvals via
 * the S-08 Sample/Order Dispatch classifier.
 *
 * Why a separate route from the generic dispatch endpoint: Amazon's
 * SP-API enrichment (order items → units, SKU breakdown, salesChannel)
 * lives here so agents / scripts just pass orderId + shipTo. Also
 * records the orderId against the `amazon:fbm:dispatched` KV so the
 * unshipped-fbm-alert dedupes properly once a label is in flight.
 *
 * Body:
 *   {
 *     orderId: "112-1234567-1234567",
 *     shipTo: {
 *       name: "Buyer Name",
 *       street1: "...",
 *       street2?: "...",
 *       city: "...",
 *       state: "CA",
 *       postalCode: "90210",
 *       phone?: "...",
 *       residential?: true
 *     },
 *     packagingType?: "mailer" | "case" | "master_carton"  // default "mailer"
 *     post?: boolean   // default true, set false for UI preview
 *   }
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  fetchOrderItems,
  fetchOrders,
  isAmazonConfigured,
} from "@/lib/amazon/sp-api";
import {
  classifyDispatch,
  composeShipmentProposal,
  type OrderIntent,
} from "@/lib/ops/sample-order-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_DISPATCHED = "amazon:fbm:dispatched";

interface DispatchedEntry {
  orderId: string;
  dispatchedAt: string;
  proposalTs?: string | null;
}

interface DispatchBody {
  orderId?: string;
  shipTo?: OrderIntent["shipTo"];
  packagingType?: OrderIntent["packagingType"];
  post?: boolean;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAmazonConfigured()) {
    return NextResponse.json(
      { error: "Amazon SP-API not configured" },
      { status: 503 },
    );
  }

  let body: DispatchBody;
  try {
    body = (await req.json()) as DispatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }
  if (!body.shipTo || !body.shipTo.name || !body.shipTo.street1) {
    return NextResponse.json(
      { error: "shipTo.name + shipTo.street1 required" },
      { status: 400 },
    );
  }

  // Enrich with SP-API — fetch line items for unit count + SKU trace.
  // The order itself isn't fetchable by ID directly (no SP-API endpoint
  // for single-order fetch), so we scan the last 7 days and filter.
  const now = new Date();
  const createdAfter = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const createdBefore = now.toISOString();
  let orderMeta: Awaited<ReturnType<typeof fetchOrders>>[number] | null = null;
  try {
    const orders = await fetchOrders(createdAfter, createdBefore);
    orderMeta = orders.find((o) => o.AmazonOrderId === body.orderId) ?? null;
  } catch (err) {
    // Non-fatal — dispatch proceeds with minimal context.
    console.error("[amazon-dispatch] order lookup failed:", err);
  }

  let totalUnits = 0;
  let orderValue = 0;
  try {
    const items = await fetchOrderItems(body.orderId);
    for (const item of items) {
      totalUnits += item.QuantityOrdered ?? 0;
      const lineTotal = Number.parseFloat(item.ItemPrice?.Amount ?? "0") || 0;
      orderValue += lineTotal;
    }
  } catch (err) {
    console.error("[amazon-dispatch] items lookup failed:", err);
  }
  if (orderValue === 0 && orderMeta?.OrderTotal?.Amount) {
    orderValue = Number.parseFloat(orderMeta.OrderTotal.Amount) || 0;
  }

  // Default single-unit FBM → 1 mailer. Multi-unit FBM → scale by units.
  const packagingType =
    body.packagingType ?? (totalUnits <= 1 ? "mailer" : "case");

  const intent: OrderIntent = {
    channel: "amazon",
    sourceId: body.orderId,
    orderNumber: body.orderId,
    valueUsd: Math.round(orderValue * 100) / 100,
    tags: [], // FBM orders aren't samples by default
    note: orderMeta?.SalesChannel
      ? `Amazon FBM · ${orderMeta.SalesChannel}`
      : "Amazon FBM",
    shipTo: {
      ...body.shipTo,
      state: body.shipTo.state.toUpperCase(),
    },
    packagingType,
    cartons: Math.max(1, packagingType === "mailer" ? totalUnits : 1),
    weightLbs:
      packagingType === "mailer"
        ? Math.max(0.55, totalUnits * 0.5 + 0.1) // each bag ~0.5 lb + mailer
        : undefined,
  };

  const classification = classifyDispatch(intent);
  const shouldPost = body.post !== false;

  if (classification.refuse) {
    // Surface refusal to #ops-alerts so Ben sees it; AR-hold doesn't
    // apply to Amazon but future refusal conditions may.
    if (shouldPost) {
      const alerts = getChannel("ops-alerts");
      if (alerts) {
        try {
          await postMessage({
            channel: alerts.name,
            text:
              `:no_entry: *Amazon FBM dispatch refused — ${body.orderId}*\n` +
              `${classification.refuseReason}`,
          });
        } catch {
          /* best-effort */
        }
      }
    }
    return NextResponse.json(
      {
        ok: false,
        refuse: true,
        refuseReason: classification.refuseReason,
        classification,
      },
      { status: 422 },
    );
  }

  const proposal = composeShipmentProposal(intent, classification);
  let proposalTs: string | null = null;
  const degraded: string[] = [];
  if (shouldPost) {
    const approvals = getChannel("ops-approvals");
    if (!approvals) {
      degraded.push("slack: #ops-approvals channel not registered");
    } else {
      try {
        const res = await postMessage({
          channel: approvals.name,
          text: proposal.renderedMarkdown,
        });
        if (res.ok) proposalTs = res.ts ?? null;
        else degraded.push("slack-post: not ok");
      } catch (err) {
        degraded.push(
          `slack-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Record dispatch so the unshipped alert stops pinging.
  const dispatched =
    ((await kv.get<DispatchedEntry[]>(KV_DISPATCHED)) ?? []) as DispatchedEntry[];
  dispatched.push({
    orderId: body.orderId,
    dispatchedAt: new Date().toISOString(),
    proposalTs,
  });
  // Cap at 500 entries.
  await kv.set(KV_DISPATCHED, dispatched.slice(-500));

  return NextResponse.json({
    ok: true,
    classification,
    proposal,
    proposalTs,
    totalUnits,
    orderValue: Math.round(orderValue * 100) / 100,
    degraded,
  });
}
