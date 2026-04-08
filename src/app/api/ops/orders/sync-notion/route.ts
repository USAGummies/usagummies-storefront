import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { syncOrderDeskToNotion } from "@/lib/ops/order-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncOrderDeskToNotion();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[orders/sync-notion] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to sync to Notion" }, { status: 500 });
  }
}
