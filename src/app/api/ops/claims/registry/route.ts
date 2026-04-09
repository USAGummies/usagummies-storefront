/**
 * GET  /api/ops/claims/registry — List all registered product claims
 * POST /api/ops/claims/registry — Add or update a claim
 *
 * GET returns: { claims: [...], count, verified, unverified, false_count }
 *
 * POST body: { id, claim, status, source, patterns, verified_by?, notes? }
 * Returns: { ok: true, claim }
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getAllClaims, upsertClaim } from "@/lib/ops/product-claims";
import type { ProductClaim } from "@/lib/ops/product-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const claims = await getAllClaims();
  return NextResponse.json({
    claims,
    count: claims.length,
    verified: claims.filter((c) => c.status === "verified").length,
    unverified: claims.filter((c) => c.status === "unverified").length,
    false_count: claims.filter((c) => c.status === "false").length,
  });
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.claim || !body.status || !body.source || !body.patterns) {
      return NextResponse.json(
        { error: "Required: id, claim, status, source, patterns (string[])" },
        { status: 400 },
      );
    }

    if (!["verified", "unverified", "false"].includes(body.status)) {
      return NextResponse.json(
        { error: "status must be: verified, unverified, or false" },
        { status: 400 },
      );
    }

    const claim: ProductClaim = {
      id: body.id,
      claim: body.claim,
      status: body.status,
      source: body.source,
      patterns: body.patterns,
      verified_date: new Date().toISOString().split("T")[0],
      verified_by: body.verified_by || "api",
      notes: body.notes,
    };

    await upsertClaim(claim);
    return NextResponse.json({ ok: true, claim });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upsert claim" },
      { status: 500 },
    );
  }
}
