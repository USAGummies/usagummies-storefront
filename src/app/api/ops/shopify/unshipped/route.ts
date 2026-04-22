/**
 * GET /api/ops/shopify/unshipped
 *
 * Shopify DTC unfulfilled-paid queue — fallback for when the
 * orders/paid webhook misses or hasn't been wired yet. Returns
 * every paid+unfulfilled order with full ship-to + line items so
 * the /ops/shopify-orders UI can one-click dispatch.
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { queryUnfulfilledPaidOrders } from "@/lib/ops/shopify-admin-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = Math.max(
    1,
    Math.min(60, Number.parseInt(url.searchParams.get("days") ?? "14", 10) || 14),
  );
  const limit = Math.max(
    1,
    Math.min(100, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
  );
  try {
    const orders = await queryUnfulfilledPaidOrders({ days, limit });
    return NextResponse.json({
      ok: true,
      totalCount: orders.length,
      generatedAt: new Date().toISOString(),
      orders,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Shopify query failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }
}
