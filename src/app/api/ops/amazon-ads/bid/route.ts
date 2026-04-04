import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { updateBid } from "@/lib/amazon/ads-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/ops/amazon-ads/bid — adjust a keyword bid */
export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  if (!body.keyword_id) {
    return NextResponse.json({ error: "keyword_id is required" }, { status: 400 });
  }
  if (!body.bid || typeof body.bid !== "number") {
    return NextResponse.json({ error: "bid (number) is required" }, { status: 400 });
  }

  const result = await updateBid(body.keyword_id, body.bid);
  if (!result) {
    return NextResponse.json({ error: "Failed to update bid" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result });
}
