import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { checkSyncHealth } from "@/lib/ops/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const health = await checkSyncHealth();
    return NextResponse.json({ ok: true, health });
  } catch (error) {
    console.error(
      "[archive/health] GET failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Health check failed" },
      { status: 500 },
    );
  }
}
