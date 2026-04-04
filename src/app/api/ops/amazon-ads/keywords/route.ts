import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { listKeywords } from "@/lib/amazon/ads-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ops/amazon-ads/keywords — list keyword/target performance */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaign_id") || undefined;

  const keywords = await listKeywords(campaignId);
  if (!keywords) {
    return NextResponse.json({ error: "Failed to fetch keywords" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: keywords.length, keywords });
}
