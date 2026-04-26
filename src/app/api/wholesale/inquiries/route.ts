/**
 * GET /api/wholesale/inquiries?token=...
 *
 * Public route. Verifies the HMAC-signed inquiry token + returns the
 * scrubbed payload (email, source, createdAt, ageSeconds) so the
 * receipt page can render personalized content without a database
 * lookup. The page then layers in live status from
 * /api/wholesale-status?email=<verified-email>.
 *
 * The route is intentionally NOT in the middleware allowlist because
 * the middleware matcher only protects /ops, /api/ops, /api/agentic,
 * and /command-center — anything outside those is public by default.
 *
 * Status codes:
 *   200 — verified
 *   400 — token query param missing or malformed
 *   401 — bad signature (token tampered or signed by another secret)
 *   410 — token expired (>30 days)
 *   503 — server misconfigured (WHOLESALE_INQUIRY_SECRET not set)
 *
 * No PII beyond what the customer typed is returned. No HubSpot
 * lookup, no Notion lookup — those happen on the page level via the
 * existing /api/wholesale-status route, keyed by the verified email.
 */
import { NextResponse } from "next/server";

import { verifyInquiryToken } from "@/lib/wholesale/inquiry-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "token query param required" },
      { status: 400 },
    );
  }

  const result = verifyInquiryToken(token);
  if (!result.ok) {
    const status =
      result.code === "secret_not_configured"
        ? 503
        : result.code === "expired"
          ? 410
          : result.code === "bad_signature"
            ? 401
            : 400;
    return NextResponse.json(
      { ok: false, code: result.code, error: result.reason },
      { status },
    );
  }

  // Convert Unix-second `c` back into ISO for human readability.
  const createdAt = new Date(result.payload.c * 1000).toISOString();
  const ageDays = Math.floor(result.ageSeconds / (24 * 3600));

  return NextResponse.json({
    ok: true,
    inquiry: {
      email: result.payload.e,
      source: result.payload.i,
      createdAt,
      ageSeconds: result.ageSeconds,
      ageDays,
      version: result.payload.v,
    },
  });
}
