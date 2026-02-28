import "server-only";

/**
 * TikTok Marketing API client — TikTok ad campaign data.
 *
 * Uses Business API v1.3 to pull campaign-level insights.
 * Docs: https://business-api.tiktok.com/portal/docs
 *
 * Required env vars:
 *   TIKTOK_ACCESS_TOKEN   — Long-lived access token from TikTok Business Center
 *   TIKTOK_ADVERTISER_ID  — Advertiser account ID
 */

export type TikTokCampaign = {
  id: string;
  name: string;
  status: string;
  objective: string;
  dailyBudget: number;
  startTime: string | null;
  stopTime: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  cpc: number;
  ctr: number;
  roas: number;
};

function tikTokToken(): string {
  return (process.env.TIKTOK_ACCESS_TOKEN || "").trim();
}

function tikTokAdvertiserId(): string {
  return (process.env.TIKTOK_ADVERTISER_ID || "").trim();
}

export function isTikTokConfigured(): boolean {
  return !!(tikTokToken() && tikTokAdvertiserId());
}

const BASE_URL = "https://business-api.tiktok.com/open_api/v1.3";

type TikTokResponse<T> = {
  code: number;
  message: string;
  data: T;
};

async function tikTokRequest<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = tikTokToken();
  if (!token) throw new Error("TIKTOK_ACCESS_TOKEN not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": token,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`TikTok API ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as TikTokResponse<T>;

    if (json.code !== 0) {
      throw new Error(`TikTok API ${path} error (code ${json.code}): ${json.message}`);
    }

    return json.data;
  } finally {
    clearTimeout(timeout);
  }
}

type TikTokCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  campaign_type?: string;
  budget?: number;
  status?: string;
  objective_type?: string;
  create_time?: string;
};

type TikTokCampaignListData = {
  list: TikTokCampaignRow[];
  page_info: { page: number; page_size: number; total_number: number; total_page: number };
};

type TikTokReportMetrics = {
  campaign_id?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  conversion?: string;
  total_purchase_value?: string;
  cpc?: string;
  ctr?: string;
};

type TikTokReportRow = {
  dimensions: { campaign_id?: string };
  metrics: TikTokReportMetrics;
};

type TikTokReportData = {
  list: TikTokReportRow[];
  page_info: { page: number; page_size: number; total_number: number; total_page: number };
};

type TikTokAccountReportRow = {
  dimensions: Record<string, string>;
  metrics: TikTokReportMetrics;
};

type TikTokAccountReportData = {
  list: TikTokAccountReportRow[];
  page_info: { page: number; page_size: number; total_number: number; total_page: number };
};

/**
 * Fetch all campaigns + their 30-day insights from TikTok Ads.
 */
export async function fetchTikTokCampaigns(): Promise<TikTokCampaign[]> {
  const advertiserId = tikTokAdvertiserId();
  if (!advertiserId) throw new Error("TIKTOK_ADVERTISER_ID not configured");

  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // 1) Get campaign list
  const campaignsRes = await tikTokRequest<TikTokCampaignListData>(
    "/campaign/get/",
    {
      advertiser_id: advertiserId,
      fields: [
        "campaign_id",
        "campaign_name",
        "campaign_type",
        "budget",
        "status",
        "objective_type",
        "create_time",
      ],
    },
  );

  const campaigns = campaignsRes.list || [];

  // 2) Get insights at campaign level for last 30 days
  const reportRes = await tikTokRequest<TikTokReportData>(
    "/report/integrated/get/",
    {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      dimensions: ["campaign_id"],
      metrics: [
        "spend",
        "impressions",
        "clicks",
        "conversion",
        "total_purchase_value",
        "cpc",
        "ctr",
      ],
      start_date: start,
      end_date: end,
      page_size: 500,
      lifetime: false,
    },
  );

  const metricsByCampaignId = new Map<string, TikTokReportMetrics>();
  for (const row of reportRes.list || []) {
    const cid = row.dimensions?.campaign_id;
    if (cid) metricsByCampaignId.set(cid, row.metrics);
  }

  // 3) Merge campaigns + insights
  return campaigns.map((c) => {
    const m = metricsByCampaignId.get(c.campaign_id);

    const spend = parseFloat(m?.spend || "0");
    const impressions = parseInt(m?.impressions || "0", 10);
    const clicks = parseInt(m?.clicks || "0", 10);
    const conversions = parseInt(m?.conversion || "0", 10);
    const revenue = parseFloat(m?.total_purchase_value || "0");
    const cpc = parseFloat(m?.cpc || "0");
    const ctr = parseFloat(m?.ctr || "0");
    const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;

    return {
      id: c.campaign_id,
      name: c.campaign_name,
      status: c.status?.toLowerCase() || "unknown",
      objective: c.objective_type || "unknown",
      dailyBudget: c.budget || 0,
      startTime: c.create_time || null,
      stopTime: null,
      spend,
      impressions,
      clicks,
      conversions,
      revenue,
      cpc,
      ctr,
      roas,
    };
  });
}

/**
 * Fetch account-level 30-day totals from TikTok Ads.
 */
export async function fetchTikTokAccountInsights(): Promise<{
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number;
}> {
  const advertiserId = tikTokAdvertiserId();
  if (!advertiserId) throw new Error("TIKTOK_ADVERTISER_ID not configured");

  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const res = await tikTokRequest<TikTokAccountReportData>(
    "/report/integrated/get/",
    {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_ADVERTISER",
      dimensions: ["advertiser_id"],
      metrics: [
        "spend",
        "impressions",
        "clicks",
        "conversion",
        "total_purchase_value",
        "cpc",
        "ctr",
      ],
      start_date: start,
      end_date: end,
      lifetime: false,
    },
  );

  const row = res.list?.[0]?.metrics;
  const spend = parseFloat(row?.spend || "0");
  const impressions = parseInt(row?.impressions || "0", 10);
  const clicks = parseInt(row?.clicks || "0", 10);
  const conversions = parseInt(row?.conversion || "0", 10);
  const revenue = parseFloat(row?.total_purchase_value || "0");
  const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;

  return { spend, impressions, clicks, conversions, revenue, roas };
}
