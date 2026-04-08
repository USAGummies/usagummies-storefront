import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getLastSyncReport } from "@/lib/ops/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await getLastSyncReport();

    if (!report) {
      return NextResponse.json(
        { ok: true, report: null, message: "No sync has been run yet" },
        { status: 200 },
      );
    }

    return NextResponse.json({ ok: true, report });
  } catch (error) {
    console.error(
      "[archive/report] GET failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to retrieve report" },
      { status: 500 },
    );
  }
}
