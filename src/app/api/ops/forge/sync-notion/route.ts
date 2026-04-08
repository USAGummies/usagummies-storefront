import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { syncForgeToNotion } from "@/lib/ops/forge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncForgeToNotion();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[forge/sync-notion] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Notion sync failed" }, { status: 500 });
  }
}
