import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  closePO,
  listPurchaseOrders,
  markDelivered,
  matchPayment,
  shipPO,
} from "@/lib/ops/operator/po-pipeline";
import {
  readEmailIntelligenceSummary,
  runEmailIntelligence,
} from "@/lib/ops/operator/email-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PO_STATUSES = new Set([
  "draft",
  "ordered",
  "received",
  "shipped",
  "delivered",
  "closed",
]);

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const operation = String(body.operation || "");

  if (operation === "po.list") {
    const statuses = Array.isArray(body.statuses)
      ? body.statuses.filter((status: string) => VALID_PO_STATUSES.has(status))
      : undefined;
    const rows = await listPurchaseOrders(statuses);
    return NextResponse.json({ ok: true, operation, count: rows.length, rows });
  }

  if (operation === "po.transition") {
    const transition = String(body.transition || "");
    if (transition === "ship") {
      const row = await shipPO({
        poNumber: body.poNumber,
        carrier: body.carrier,
        trackingNumber: body.trackingNumber,
        shippingCost: body.shippingCost,
        estimatedDelivery: body.estimatedDelivery ?? null,
        note: body.note ?? null,
      });
      return NextResponse.json({ ok: true, operation, transition, row });
    }
    if (transition === "mark_delivered") {
      const row = await markDelivered({ poNumber: body.poNumber, note: body.note ?? null });
      return NextResponse.json({ ok: true, operation, transition, row });
    }
    if (transition === "match_payment") {
      if (body.depositAmount === undefined || !body.depositDate) {
        return NextResponse.json(
          { ok: false, error: "depositAmount and depositDate are required for match_payment" },
          { status: 400 },
        );
      }
      const row = await matchPayment({
        poNumber: body.poNumber,
        depositAmount: body.depositAmount,
        depositDate: body.depositDate,
        note: body.note ?? null,
      });
      return NextResponse.json({ ok: true, operation, transition, row });
    }
    if (transition === "close") {
      const row = await closePO({ poNumber: body.poNumber, note: body.note ?? null });
      return NextResponse.json({ ok: true, operation, transition, row });
    }
    return NextResponse.json({ ok: false, error: `Unknown transition: ${transition}` }, { status: 400 });
  }

  if (operation === "email_intelligence.run") {
    const result = await runEmailIntelligence({
      messageIds: Array.isArray(body.messageIds)
        ? body.messageIds.map((id: string) => id.trim()).filter(Boolean)
        : undefined,
      includeRecent: Boolean(body.includeRecent),
      forceSummary: Boolean(body.forceSummary),
      reprocess: Boolean(body.reprocess),
    });
    return NextResponse.json({ ok: true, operation, ...result });
  }

  if (operation === "email_intelligence.summary") {
    const summary = await readEmailIntelligenceSummary();
    return NextResponse.json({ ok: true, operation, summary });
  }

  return NextResponse.json({ ok: false, error: `Unknown operation: ${operation}` }, { status: 400 });
}
