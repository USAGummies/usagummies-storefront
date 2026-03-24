/**
 * POST /api/ops/plaid/link-token — Create a Plaid Link token
 *
 * Returns a link_token that the frontend uses to open Plaid Link UI.
 */

import { NextResponse } from "next/server";
import { createLinkToken, isPlaidConfigured, getPlaidEnv } from "@/lib/finance/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isPlaidConfigured()) {
    return NextResponse.json(
      { error: "Plaid not configured. Set PLAID_CLIENT_ID and PLAID_SECRET." },
      { status: 503 },
    );
  }

  try {
    let redirectUri: string | undefined;
    try {
      const body = await request.json();
      redirectUri = body.redirectUri;
    } catch {
      // No body is fine — redirectUri stays undefined
    }

    const linkToken = await createLinkToken(redirectUri);
    return NextResponse.json({ linkToken, env: getPlaidEnv() });
  } catch (err) {
    console.error("[plaid] Link token creation failed:", err);
    return NextResponse.json(
      { error: "Failed to create link token" },
      { status: 500 },
    );
  }
}
