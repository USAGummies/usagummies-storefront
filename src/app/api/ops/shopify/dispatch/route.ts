/**
 * POST /api/ops/shopify/dispatch
 *
 * Shopify DTC fallback dispatch bridge. Pairs with /ops/shopify-orders
 * UI as a manual catch path when the orders/paid webhook misses or
 * hasn't been configured yet.
 *
 * Body: { orderId: string }  — Shopify GID (e.g. "gid://shopify/Order/1234")
 *        OR { orderName: string } — e.g. "#1018"
 *        + optional { post?: boolean }  — default true
 *
 * Hydrates the order via queryUnfulfilledPaidOrders (the existing
 * Shopify admin client), builds an OrderIntent, runs the S-08
 * classifier, posts the Class B proposal to #ops-approvals.
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
import { queryUnfulfilledPaidOrders } from "@/lib/ops/shopify-admin-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DispatchBody {
  orderId?: string;
  orderName?: string;
  post?: boolean;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: DispatchBody;
  try {
    body = (await req.json()) as DispatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.orderId && !body.orderName) {
    return NextResponse.json(
      { error: "orderId or orderName required" },
      { status: 400 },
    );
  }

  // Fetch a narrow window of candidates; filter.
  const orders = await queryUnfulfilledPaidOrders({ days: 30, limit: 100 });
  const match = orders.find((o) => {
    if (body.orderId && o.id === body.orderId) return true;
    if (body.orderName && o.name === body.orderName) return true;
    return false;
  });
  if (!match) {
    return NextResponse.json(
      {
        error: "Order not found among unfulfilled paid orders (last 30 days)",
        searched: { orderId: body.orderId, orderName: body.orderName },
      },
      { status: 404 },
    );
  }

  const ship = match.shippingAddress;
  if (!ship || !ship.address1 || !ship.city || !ship.provinceCode || !ship.zip) {
    return NextResponse.json(
      {
        error:
          "Shopify order missing complete ship-to (address1 / city / provinceCode / zip)",
        order: { id: match.id, name: match.name },
      },
      { status: 422 },
    );
  }

  const totalUnits = match.lineItems.reduce((s, l) => s + l.quantity, 0);
  const isSample = match.tags.some((t) => /\bsample\b/i.test(t));
  const intent: OrderIntent = {
    channel: "shopify",
    sourceId: match.id,
    orderNumber: match.name,
    valueUsd: match.totalAmount,
    tags: match.tags,
    note: match.note ?? undefined,
    shipTo: {
      name:
        ship.name ?? match.customer?.displayName ?? "Shopify customer",
      company: ship.company ?? undefined,
      street1: ship.address1,
      street2: ship.address2 ?? undefined,
      city: ship.city,
      state: ship.provinceCode.toUpperCase(),
      postalCode: ship.zip,
      country: ship.countryCode ?? "US",
      phone: ship.phone ?? match.customer?.phone ?? undefined,
      residential: true,
    },
    // Single-unit DTC → mailer; multi-unit → case; sample tag → case.
    packagingType:
      totalUnits <= 1 && !isSample
        ? "mailer"
        : isSample
          ? "case"
          : totalUnits <= 6
            ? "case"
            : "master_carton",
    cartons: Math.max(1, totalUnits <= 6 ? 1 : Math.ceil(totalUnits / 36)),
    weightLbs: totalUnits <= 1 ? 0.55 : undefined,
  };

  const classification = classifyDispatch(intent);
  const shouldPost = body.post !== false;

  if (classification.refuse) {
    if (shouldPost) {
      const alerts = getChannel("ops-alerts");
      if (alerts) {
        try {
          await postMessage({
            channel: alerts.name,
            text:
              `:no_entry: *Shopify dispatch refused — ${match.name}*\n` +
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
  const degraded: string[] = [];
  let postedTs: string | null = null;
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
        if (res.ok) postedTs = res.ts ?? null;
        else degraded.push("slack-post: not ok");
      } catch (err) {
        degraded.push(
          `slack-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    classification,
    proposal,
    postedTs,
    totalUnits,
    orderValue: match.totalAmount,
    degraded,
  });
}
