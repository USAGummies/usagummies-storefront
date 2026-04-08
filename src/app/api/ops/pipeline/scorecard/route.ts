/**
 * GET /api/ops/pipeline/scorecard — Pipeline health scorecard
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getScorecard } from "@/lib/ops/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scorecard = await getScorecard();
  return NextResponse.json(scorecard);
}
