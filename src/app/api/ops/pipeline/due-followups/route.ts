/**
 * GET /api/ops/pipeline/due-followups — Prospects with follow-ups due today or overdue
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getDueFollowups } from "@/lib/ops/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const channel_type = url.searchParams.get("channel_type") as any;

  const due = await getDueFollowups({
    channel_type: channel_type || undefined,
  });

  return NextResponse.json({ due, count: due.length });
}
