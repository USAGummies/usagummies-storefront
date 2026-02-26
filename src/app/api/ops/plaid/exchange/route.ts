/**
 * POST /api/ops/plaid/exchange — Exchange Plaid public token for access token
 *
 * Called after user completes Plaid Link flow. Stores access_token in KV.
 */

import { NextResponse } from "next/server";
import { exchangePublicToken, isPlaidConfigured } from "@/lib/finance/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isPlaidConfigured()) {
    return NextResponse.json(
      { error: "Plaid not configured" },
      { status: 503 },
    );
  }

  try {
    const { publicToken } = await req.json();
    if (!publicToken) {
      return NextResponse.json({ error: "publicToken required" }, { status: 400 });
    }

    const result = await exchangePublicToken(publicToken);
    return NextResponse.json({
      success: true,
      itemId: result.itemId,
    });
  } catch (err) {
    console.error("[plaid] Token exchange failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Token exchange failed" },
      { status: 500 },
    );
  }
}
