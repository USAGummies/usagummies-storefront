/**
 * GET /api/ops/amazon — Amazon KPI data via SP-API
 *
 * Returns comprehensive Amazon performance metrics:
 *   orders, revenue, AOV, units, order status, inventory,
 *   fees, velocity, and period comparisons.
 *
 * Uses the shared kpi-builder for all computation.
 * Cached in Vercel KV with 15-min TTL to respect rate limits.
 * Protected by middleware (requires JWT session or self-auth).
 */

import { NextResponse } from "next/server";
import { isAmazonConfigured } from "@/lib/amazon/sp-api";
import { getCachedKPIs, setCachedKPIs } from "@/lib/amazon/cache";
import { buildAmazonKPIs } from "@/lib/amazon/kpi-builder";
import type { AmazonKPIs } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAmazonConfigured()) {
    return NextResponse.json({
      amazon: null,
      error: "Amazon SP-API not configured",
      generatedAt: new Date().toISOString(),
    });
  }

  // Check cache first
  const cached = await getCachedKPIs<AmazonKPIs>();
  if (cached) {
    return NextResponse.json({
      amazon: cached,
      fromCache: true,
      generatedAt: new Date().toISOString(),
    });
  }

  try {
    // Build KPIs using shared sequential-fetch logic
    const kpis = await buildAmazonKPIs();

    // Cache the result
    await setCachedKPIs(kpis);

    return NextResponse.json({
      amazon: kpis,
      fromCache: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[amazon-kpi] Failed:", err);
    return NextResponse.json(
      {
        amazon: null,
        error: err instanceof Error ? err.message : String(err),
        generatedAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
