/**
 * GET /api/ops/auth-audit — Security audit trail
 *
 * Returns recent auth events and stats.
 * Query params:
 *   ?limit=50 (default 100)
 *   ?event_type=login_failure (optional filter)
 *   ?hours=24 (stats window, default 24)
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { auth } from "@/lib/auth/config";
import {
  getRecentAuthEvents,
  getAuthStats,
  type AuthAuditEvent,
} from "@/lib/ops/auth-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Require admin role for audit access
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Extra check: only admins can view audit trail
  try {
    const session = await auth();
    if (session?.user?.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }
  } catch {
    // Cron context — allow
  }

  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const eventType = url.searchParams.get("event_type") as
      | AuthAuditEvent
      | undefined;
    const hours = parseInt(url.searchParams.get("hours") || "24", 10);

    const [events, stats] = await Promise.all([
      getRecentAuthEvents(limit, eventType || undefined),
      getAuthStats(hours),
    ]);

    return NextResponse.json({
      events,
      stats,
      query: { limit, eventType: eventType || "all", statsWindow: `${hours}h` },
    });
  } catch (err) {
    console.error("[auth-audit] API failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to fetch audit log",
      },
      { status: 500 },
    );
  }
}
