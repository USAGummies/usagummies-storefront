import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { syncFromShopify } from "@/lib/ops/freight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST — Pull fulfillment data from Shopify into FREIGHT
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let lookbackDays = 30;

    // Allow optional body with lookback_days
    try {
      const body = await req.json();
      if (body.lookback_days && typeof body.lookback_days === "number") {
        lookbackDays = Math.min(Math.max(body.lookback_days, 1), 90);
      }
    } catch {
      // No body or invalid JSON — use default
    }

    const result = await syncFromShopify(lookbackDays);

    return NextResponse.json({
      ok: true,
      synced: result.synced,
      errors: result.errors,
      lookback_days: lookbackDays,
    });
  } catch (error) {
    console.error(
      "[freight/sync-shopify] POST failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Shopify sync failed" },
      { status: 500 },
    );
  }
}
