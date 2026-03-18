/**
 * GET /api/ops/abra/ap-ar — AP/AR Aging Dashboard
 *
 * Returns the full AgingSummary: payables, receivables, aging buckets,
 * and net position. Powers the finance page and Abra intelligence.
 *
 * Protected by session auth (dashboard endpoint, not cron).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getAgingSummary } from "@/lib/ops/ap-ar-aging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await getAgingSummary();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[ap-ar] Failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to fetch AP/AR data",
      },
      { status: 500 },
    );
  }
}
