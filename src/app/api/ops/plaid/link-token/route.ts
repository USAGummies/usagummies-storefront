/**
 * POST /api/ops/plaid/link-token — Create a Plaid Link token
 *
 * Returns a link_token that the frontend uses to open Plaid Link UI.
 */

import { NextResponse } from "next/server";
import { createLinkToken, isPlaidConfigured } from "@/lib/finance/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isPlaidConfigured()) {
    return NextResponse.json(
      { error: "Plaid not configured. Set PLAID_CLIENT_ID and PLAID_SECRET." },
      { status: 503 },
    );
  }

  try {
    const linkToken = await createLinkToken();
    return NextResponse.json({ linkToken });
  } catch (err) {
    console.error("[plaid] Link token creation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create link token" },
      { status: 500 },
    );
  }
}
