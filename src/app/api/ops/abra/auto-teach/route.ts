/**
 * POST /api/ops/abra/auto-teach — Run automated knowledge feeds
 *
 * Called by ABRA9 agent on schedule, or manually.
 *
 * Query params:
 *   ?feed=shopify_orders — run a specific feed
 *   (no params) — run all due feeds
 *
 * Returns: { results: FeedResult[] }
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { runFeed, runAllDueFeeds } from "@/lib/ops/abra-auto-teach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    // Also allow internal calls via cron secret
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const feedKey = url.searchParams.get("feed");

  try {
    if (feedKey) {
      // Run specific feed
      const result = await runFeed(feedKey);
      return NextResponse.json({ results: [result] });
    }

    // Run all due feeds
    const results = await runAllDueFeeds();
    return NextResponse.json({
      results,
      summary: {
        total: results.length,
        success: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        entriesCreated: results.reduce((s, r) => s + r.entriesCreated, 0),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Auto-teach failed",
      },
      { status: 500 },
    );
  }
}
