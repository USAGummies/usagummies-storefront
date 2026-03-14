/**
 * POST /api/ops/abra/seed-cpg — Seed CPG brain entries
 *
 * One-time endpoint to load 10 foundational CPG operations knowledge
 * entries into the brain (Supabase). Idempotent — skips existing entries.
 *
 * Auth: admin session or CRON_SECRET bearer token.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { seedCPGBrainEntries } from "@/lib/ops/abra-brain-seeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Embedding generation for 10 entries can take a moment

export async function POST(req: Request) {
  try {
    if (!(await isAuthorized(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await seedCPGBrainEntries();

    return NextResponse.json({
      success: true,
      ...result,
      message: `CPG brain seeds: ${result.created} created, ${result.skipped} already existed`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[seed-cpg] Error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
