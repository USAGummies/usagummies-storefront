import "server-only";

/**
 * Meta Marketing API client — Facebook/Instagram ad campaign data.
 *
 * Uses Graph API v21.0 to pull campaign-level insights.
 * Docs: https://developers.facebook.com/docs/marketing-api/insights
 *
 * Required env vars:
 *   META_ACCESS_TOKEN   — Long-lived system user token from Business Manager
 *   META_AD_ACCOUNT_ID  — Numeric ad account ID (no "act_" prefix)
 */

export type MetaCampaign = {
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

function metaToken(): string {
  return (process.env.META_ACCESS_TOKEN || "").trim();
}

function metaAdAccountId(): string {
  return (process.env.META_AD_ACCOUNT_ID || "").trim();
}

export function isMetaConfigured(): boolean {
  return !!(metaToken() && metaAdAccountId());
}

async function graphRequest<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = metaToken();
  if (!token) throw new Error("META_ACCESS_TOKEN not configured");

  const url = new URL(`https://graph.facebook.com/v21.0${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(url.toString(), {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Meta API ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

type GraphCampaign = {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
  start_time?: string;
  stop_time?: string;
};

type GraphInsightRow = {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  cpc?: string;
  ctr?: string;
  purchase_roas?: Array<{ action_type: string; value: string }>;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
};

type GraphResponse<T> = {
  data: T[];
  paging?: { next?: string };
};

/**
 * Fetch all campaigns + their 30-day insights from Meta Ads.
 */
export async function fetchMetaCampaigns(): Promise<MetaCampaign[]> {
  const accountId = metaAdAccountId();
  if (!accountId) throw new Error("META_AD_ACCOUNT_ID not configured");

  // 1) Get campaign list
  const campaignsRes = await graphRequest<GraphResponse<GraphCampaign>>(
    `/act_${accountId}/campaigns`,
    {
      fields: "id,name,status,objective,daily_budget,start_time,stop_time",
      limit: "100",
    },
  );

  const campaigns = campaignsRes.data || [];

  // 2) Get insights at campaign level for last 30 days
  const insightsRes = await graphRequest<GraphResponse<GraphInsightRow>>(
    `/act_${accountId}/insights`,
    {
      fields: "campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr,purchase_roas,actions,action_values",
      level: "campaign",
      date_preset: "last_30d",
      limit: "500",
    },
  );

  const insightsByID = new Map<string, GraphInsightRow>();
  for (const row of insightsRes.data || []) {
    if (row.campaign_id) insightsByID.set(row.campaign_id, row);
  }

  // 3) Merge campaigns + insights
  return campaigns.map((c) => {
    const ins = insightsByID.get(c.id);

    const spend = parseFloat(ins?.spend || "0");
    const impressions = parseInt(ins?.impressions || "0", 10);
    const clicks = parseInt(ins?.clicks || "0", 10);
    const cpc = parseFloat(ins?.cpc || "0");
    const ctr = parseFloat(ins?.ctr || "0");

    // Extract purchase conversions from actions array
    const purchaseActions = ins?.actions?.find(
      (a) => a.action_type === "purchase" || a.action_type === "omni_purchase",
    );
    const conversions = parseInt(purchaseActions?.value || "0", 10);

    // Extract purchase revenue from action_values array
    const purchaseValues = ins?.action_values?.find(
      (a) => a.action_type === "purchase" || a.action_type === "omni_purchase",
    );
    const revenue = parseFloat(purchaseValues?.value || "0");

    const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;

    return {
      id: c.id,
      name: c.name,
      status: c.status?.toLowerCase() || "unknown",
      objective: c.objective || "unknown",
      dailyBudget: parseFloat(c.daily_budget || "0") / 100, // Meta stores in cents
      startTime: c.start_time || null,
      stopTime: c.stop_time || null,
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
 * Fetch account-level 30-day totals from Meta Ads.
 */
export async function fetchMetaAccountInsights(): Promise<{
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number;
}> {
  return fetchMetaAccountInsightsForPreset("last_30d");
}

/**
 * Fetch yesterday's account-level totals from Meta Ads. Used by the
 * ad-spend kill switch — surfaces "we spent $X yesterday with N
 * conversions" which is the catchable signal for misconfigured ads.
 */
export async function fetchMetaAccountInsightsYesterday(): Promise<{
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number;
}> {
  return fetchMetaAccountInsightsForPreset("yesterday");
}

async function fetchMetaAccountInsightsForPreset(
  datePreset: "yesterday" | "last_30d" | "today",
): Promise<{
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number;
}> {
  const accountId = metaAdAccountId();
  if (!accountId) throw new Error("META_AD_ACCOUNT_ID not configured");

  const res = await graphRequest<GraphResponse<GraphInsightRow>>(
    `/act_${accountId}/insights`,
    {
      fields: "spend,impressions,clicks,actions,action_values,purchase_roas",
      date_preset: datePreset,
    },
  );

  const row = res.data?.[0];
  const spend = parseFloat(row?.spend || "0");
  const impressions = parseInt(row?.impressions || "0", 10);
  const clicks = parseInt(row?.clicks || "0", 10);

  const purchaseActions = row?.actions?.find(
    (a) => a.action_type === "purchase" || a.action_type === "omni_purchase",
  );
  const conversions = parseInt(purchaseActions?.value || "0", 10);

  const purchaseValues = row?.action_values?.find(
    (a) => a.action_type === "purchase" || a.action_type === "omni_purchase",
  );
  const revenue = parseFloat(purchaseValues?.value || "0");
  const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;

  return { spend, impressions, clicks, conversions, revenue, roas };
}
