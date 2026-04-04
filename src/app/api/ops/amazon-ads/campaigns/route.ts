import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listCampaigns, updateCampaignBudget } from "@/lib/amazon/ads-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ops/amazon-ads/campaigns — list all SP campaigns */
export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaigns = await listCampaigns();
  if (!campaigns) {
    return NextResponse.json({ error: "Failed to fetch campaigns — check LWA credentials" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: campaigns.length, campaigns });
}

/** PUT /api/ops/amazon-ads/campaigns — update campaign budget */
export async function PUT(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  if (!body.campaign_id || !body.daily_budget) {
    return NextResponse.json({ error: "campaign_id and daily_budget are required" }, { status: 400 });
  }

  const result = await updateCampaignBudget(body.campaign_id, body.daily_budget);
  if (!result) {
    return NextResponse.json({ error: "Failed to update campaign budget" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result });
}
