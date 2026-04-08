/**
 * POST /api/ops/pipeline/log-touch — Log a contact touch (email, call, sample, etc.)
 * GET  /api/ops/pipeline/log-touch — List touch records with optional filters
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { logTouch, getTouches } from "@/lib/ops/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = await logTouch(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to log touch" },
      { status: 400 },
    );
  }
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const prospect_id = url.searchParams.get("prospect_id") || undefined;
  const type = url.searchParams.get("type") as any;
  const limit = url.searchParams.get("limit");

  const touches = await getTouches({
    prospect_id,
    type: type || undefined,
    limit: limit ? parseInt(limit) : undefined,
  });

  return NextResponse.json({ touches, count: touches.length });
}
