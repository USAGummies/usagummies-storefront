import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { listSlackEventReceipts } from "@/lib/ops/slack-event-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "25");
  const receipts = await listSlackEventReceipts({ limit });
  return NextResponse.json({
    ok: true,
    count: receipts.length,
    receipts,
    totals: {
      recognized: receipts.filter((r) => r.recognized).length,
      skipped: receipts.filter((r) => r.skippedReason).length,
    },
  });
}
