import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getDailyGoalSnapshot } from "@/lib/ops/daily-goal-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await getDailyGoalSnapshot();
    if (!snapshot) {
      return NextResponse.json(
        { ok: false, error: "No pro forma data for current month" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, goal: snapshot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get goals" },
      { status: 500 },
    );
  }
}
