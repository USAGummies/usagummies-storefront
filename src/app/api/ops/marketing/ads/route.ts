import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/ops/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualCampaign = {
  id: string;
  platform: "rumble" | "meta" | "google" | "tiktok";
  name: string;
  status: "active" | "paused" | "completed";
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  startDate: string;
  endDate: string | null;
};

type AdsResponse = {
  campaigns: ManualCampaign[];
  byPlatform: Array<{
    platform: string;
    spend: number;
    revenue: number;
    roas: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
  }>;
  generatedAt: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function compute(campaigns: ManualCampaign[]): AdsResponse {
  const grouped = new Map<string, { spend: number; revenue: number; impressions: number; clicks: number }>();
  for (const campaign of campaigns) {
    const current = grouped.get(campaign.platform) || {
      spend: 0,
      revenue: 0,
      impressions: 0,
      clicks: 0,
    };
    current.spend += Number(campaign.spend || 0);
    current.revenue += Number(campaign.revenue || 0);
    current.impressions += Number(campaign.impressions || 0);
    current.clicks += Number(campaign.clicks || 0);
    grouped.set(campaign.platform, current);
  }

  const byPlatform = Array.from(grouped.entries()).map(([platform, values]) => {
    const ctr = values.impressions > 0 ? (values.clicks / values.impressions) * 100 : 0;
    const cpc = values.clicks > 0 ? values.spend / values.clicks : 0;
    return {
      platform,
      spend: round2(values.spend),
      revenue: round2(values.revenue),
      roas: values.spend > 0 ? round2(values.revenue / values.spend) : 0,
      impressions: values.impressions,
      clicks: values.clicks,
      ctr: round2(ctr),
      cpc: round2(cpc),
    };
  });

  return {
    campaigns,
    byPlatform,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const campaigns = await readState<ManualCampaign[]>("ad-campaigns-cache", []);
  return NextResponse.json(compute(Array.isArray(campaigns) ? campaigns : []));
}

type Body = {
  action?: "add" | "update";
  id?: string;
  campaign?: Partial<ManualCampaign>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const existing = await readState<ManualCampaign[]>("ad-campaigns-cache", []);
    const campaigns = Array.isArray(existing) ? [...existing] : [];

    if (body.action === "add") {
      const input = body.campaign || {};
      const campaign: ManualCampaign = {
        id: `ad-${Date.now()}`,
        platform: (input.platform as ManualCampaign["platform"]) || "rumble",
        name: String(input.name || "Untitled Campaign"),
        status: (input.status as ManualCampaign["status"]) || "active",
        spend: Number(input.spend || 0),
        impressions: Number(input.impressions || 0),
        clicks: Number(input.clicks || 0),
        conversions: Number(input.conversions || 0),
        revenue: Number(input.revenue || 0),
        startDate: String(input.startDate || new Date().toISOString().slice(0, 10)),
        endDate: input.endDate ? String(input.endDate) : null,
      };
      campaigns.unshift(campaign);
    } else if (body.action === "update") {
      if (!body.id) {
        return NextResponse.json({ error: "id is required for update" }, { status: 400 });
      }
      const idx = campaigns.findIndex((campaign) => campaign.id === body.id);
      if (idx === -1) {
        return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      }
      campaigns[idx] = {
        ...campaigns[idx],
        ...(body.campaign || {}),
        spend: Number(body.campaign?.spend ?? campaigns[idx].spend),
        impressions: Number(body.campaign?.impressions ?? campaigns[idx].impressions),
        clicks: Number(body.campaign?.clicks ?? campaigns[idx].clicks),
        conversions: Number(body.campaign?.conversions ?? campaigns[idx].conversions),
        revenue: Number(body.campaign?.revenue ?? campaigns[idx].revenue),
      };
    } else {
      return NextResponse.json({ error: "Unsupported action. Use add | update" }, { status: 400 });
    }

    await writeState("ad-campaigns-cache", campaigns);
    return NextResponse.json({ ok: true, ...compute(campaigns) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
