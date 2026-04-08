import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { syncAllSources, type SyncSource } from "@/lib/ops/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let sources: SyncSource[] | undefined;

    try {
      const body = await req.json();
      if (body.sources && Array.isArray(body.sources)) {
        sources = body.sources as SyncSource[];
      }
    } catch {
      // Empty body is fine — sync all sources
    }

    const report = await syncAllSources(sources);

    const hasErrors = report.results.some((r) => r.status === "error");
    const allErrors = report.results.every((r) => r.status === "error");

    return NextResponse.json(
      { ok: !allErrors, report },
      { status: allErrors ? 500 : hasErrors ? 207 : 200 },
    );
  } catch (error) {
    console.error(
      "[archive/sync] POST failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Sync failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
