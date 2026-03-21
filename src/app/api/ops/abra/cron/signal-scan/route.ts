/**
 * POST/GET /api/ops/abra/cron/signal-scan
 *
 * Proactive signal detection — scans all data streams for actionable
 * patterns and alerts via Slack. Schedule via QStash every 30-60 min.
 */

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { scanAndAlert } from "@/lib/ops/signals/signal-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function handler(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await scanAndAlert();
    return NextResponse.json({
      ok: true,
      signals: result.signals.length,
      scanned: result.scanned,
      errors: result.errors,
      details: result.signals,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Signal scan failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return handler(req);
}

export async function POST(req: Request) {
  return handler(req);
}
