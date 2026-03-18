import { NextResponse } from "next/server";
import { revokeTokens } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disconnect QuickBooks Online — revokes tokens and clears KV.
 *
 * POST /api/ops/qbo/disconnect
 */
export async function POST() {
  try {
    const success = await revokeTokens();

    if (success) {
      return NextResponse.json({
        status: "disconnected",
        message: "QBO tokens revoked and cleared",
      });
    }

    return NextResponse.json(
      { error: "Failed to revoke tokens" },
      { status: 500 },
    );
  } catch (err) {
    console.error("[qbo] Disconnect error:", err);
    return NextResponse.json(
      { error: "Failed to disconnect QBO" },
      { status: 500 },
    );
  }
}
