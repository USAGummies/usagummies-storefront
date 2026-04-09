/**
 * POST /api/ops/claims/validate — Outreach Claim Verification Gate
 *
 * Scans email text for product claims and validates each against
 * the verified claims registry. Returns pass/fail with details.
 *
 * Body: { text: string }   — the full email (subject + body)
 * Returns: { safe, found_claims, blocked, summary }
 *
 * If safe=false, the email MUST NOT be sent.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { validateOutreachClaims } from "@/lib/ops/product-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.text || typeof body.text !== "string") {
      return NextResponse.json(
        { error: "Required: text (string — the email subject + body to validate)" },
        { status: 400 },
      );
    }

    const result = await validateOutreachClaims(body.text);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Claim validation failed" },
      { status: 500 },
    );
  }
}
