import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/ops/state";
import { isMetaConfigured, fetchMetaCampaigns } from "@/lib/ads/meta";
import { isTikTokConfigured, fetchTikTokCampaigns } from "@/lib/ads/tiktok";
import { isGoogleAdsConfigured, fetchGoogleAdsCampaigns } from "@/lib/ads/google";
import type { CacheEnvelope } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYNC_TTL = 15 * 60 * 1000; // 15 min

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

type PlatformStatus = {
  platform: string;
  configured: boolean;
  lastSynced: string | null;
  error: string | null;
  campaignCount: number;
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
  platformStatus: PlatformStatus[];
  generatedAt: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function compute(campaigns: ManualCampaign[], platformStatus: PlatformStatus[]): AdsResponse {
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
    platformStatus,
    generatedAt: new Date().toISOString(),
  };
}

/** Sync a single platform — returns campaigns or empty array on failure */
async function syncPlatform(
  platform: "meta" | "tiktok" | "google",
  cacheKey: "meta-ads-cache" | "tiktok-ads-cache" | "google-ads-cache",
  fetcher: () => Promise<Array<{ id: string; name: string; status: string; objective: string; dailyBudget: number; startTime: string | null; stopTime: string | null; spend: number; impressions: number; clicks: number; conversions: number; revenue: number; cpc: number; ctr: number; roas: number }>>,
  force: boolean,
): Promise<{ campaigns: ManualCampaign[]; status: PlatformStatus }> {
  // Check cache
  if (!force) {
    const cached = await readState<CacheEnvelope<ManualCampaign[]> | null>(cacheKey, null);
    if (cached && Date.now() - cached.cachedAt < SYNC_TTL) {
      return {
        campaigns: cached.data || [],
        status: {
          platform,
          configured: true,
          lastSynced: new Date(cached.cachedAt).toISOString(),
          error: null,
          campaignCount: (cached.data || []).length,
        },
      };
    }
  }

  try {
    const raw = await fetcher();
    const campaigns: ManualCampaign[] = raw.map((c) => ({
      id: `${platform}-${c.id}`,
      platform,
      name: c.name,
      status: (c.status === "active" ? "active" : c.status === "paused" ? "paused" : "completed") as ManualCampaign["status"],
      spend: c.spend,
      impressions: c.impressions,
      clicks: c.clicks,
      conversions: c.conversions,
      revenue: c.revenue,
      startDate: c.startTime?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      endDate: c.stopTime?.slice(0, 10) || null,
    }));

    await writeState(cacheKey, { data: campaigns, cachedAt: Date.now() });

    return {
      campaigns,
      status: {
        platform,
        configured: true,
        lastSynced: new Date().toISOString(),
        error: null,
        campaignCount: campaigns.length,
      },
    };
  } catch (err) {
    // Return cached data on failure if available
    const cached = await readState<CacheEnvelope<ManualCampaign[]> | null>(cacheKey, null);
    return {
      campaigns: cached?.data || [],
      status: {
        platform,
        configured: true,
        lastSynced: cached ? new Date(cached.cachedAt).toISOString() : null,
        error: err instanceof Error ? err.message : String(err),
        campaignCount: (cached?.data || []).length,
      },
    };
  }
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";

  // Load manual campaigns (Rumble)
  const manualCampaigns = await readState<ManualCampaign[]>("ad-campaigns-cache", []);
  const rumble = Array.isArray(manualCampaigns) ? manualCampaigns.filter((c) => c.platform === "rumble") : [];

  const platformStatus: PlatformStatus[] = [
    {
      platform: "rumble",
      configured: true,
      lastSynced: new Date().toISOString(),
      error: null,
      campaignCount: rumble.length,
    },
  ];

  // Auto-sync configured platforms in parallel
  const syncPromises: Promise<{ campaigns: ManualCampaign[]; status: PlatformStatus }>[] = [];

  if (isMetaConfigured()) {
    syncPromises.push(syncPlatform("meta", "meta-ads-cache", fetchMetaCampaigns, force));
  } else {
    platformStatus.push({ platform: "meta", configured: false, lastSynced: null, error: null, campaignCount: 0 });
  }

  if (isTikTokConfigured()) {
    syncPromises.push(syncPlatform("tiktok", "tiktok-ads-cache", fetchTikTokCampaigns, force));
  } else {
    platformStatus.push({ platform: "tiktok", configured: false, lastSynced: null, error: null, campaignCount: 0 });
  }

  if (isGoogleAdsConfigured()) {
    syncPromises.push(syncPlatform("google", "google-ads-cache", fetchGoogleAdsCampaigns, force));
  } else {
    platformStatus.push({ platform: "google", configured: false, lastSynced: null, error: null, campaignCount: 0 });
  }

  const results = await Promise.allSettled(syncPromises);

  let allCampaigns = [...rumble];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allCampaigns = allCampaigns.concat(result.value.campaigns);
      platformStatus.push(result.value.status);
    }
  }

  return NextResponse.json(compute(allCampaigns, platformStatus));
}

type Body = {
  action?: "add" | "update" | "sync";
  id?: string;
  campaign?: Partial<ManualCampaign>;
  platform?: "meta" | "tiktok" | "google";
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    // Force re-sync a specific platform
    if (body.action === "sync") {
      const platform = body.platform;
      if (!platform || !["meta", "tiktok", "google"].includes(platform)) {
        return NextResponse.json({ error: "platform must be meta | tiktok | google" }, { status: 400 });
      }

      const fetchers: Record<string, () => ReturnType<typeof fetchMetaCampaigns>> = {
        meta: fetchMetaCampaigns,
        tiktok: fetchTikTokCampaigns,
        google: fetchGoogleAdsCampaigns,
      };
      const cacheKeys: Record<string, "meta-ads-cache" | "tiktok-ads-cache" | "google-ads-cache"> = {
        meta: "meta-ads-cache",
        tiktok: "tiktok-ads-cache",
        google: "google-ads-cache",
      };

      const result = await syncPlatform(
        platform as "meta" | "tiktok" | "google",
        cacheKeys[platform],
        fetchers[platform],
        true,
      );

      return NextResponse.json({ ok: true, synced: result.status });
    }

    // Manual campaign CRUD (for Rumble)
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
      return NextResponse.json({ error: "Unsupported action. Use add | update | sync" }, { status: 400 });
    }

    await writeState("ad-campaigns-cache", campaigns);
    return NextResponse.json({ ok: true, ...compute(campaigns, []) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
