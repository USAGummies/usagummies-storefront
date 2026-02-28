import "server-only";

/**
 * Google Ads API client — campaign data via REST API v18.
 *
 * Uses GAQL (Google Ads Query Language) via searchStream endpoint.
 * Docs: https://developers.google.com/google-ads/api/docs/query/overview
 *
 * Required env vars:
 *   GOOGLE_ADS_DEVELOPER_TOKEN  — Developer token from Google Ads API Center
 *   GOOGLE_ADS_CLIENT_ID        — OAuth2 client ID
 *   GOOGLE_ADS_CLIENT_SECRET    — OAuth2 client secret
 *   GOOGLE_ADS_REFRESH_TOKEN    — OAuth2 refresh token
 *   GOOGLE_ADS_CUSTOMER_ID      — Numeric customer ID (no dashes)
 */

export type GoogleAdsCampaign = {
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

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function envDeveloperToken(): string {
  return (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
}

function envClientId(): string {
  return (process.env.GOOGLE_ADS_CLIENT_ID || "").trim();
}

function envClientSecret(): string {
  return (process.env.GOOGLE_ADS_CLIENT_SECRET || "").trim();
}

function envRefreshToken(): string {
  return (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim();
}

function envCustomerId(): string {
  return (process.env.GOOGLE_ADS_CUSTOMER_ID || "").trim();
}

export function isGoogleAdsConfigured(): boolean {
  return !!(
    envDeveloperToken() &&
    envClientId() &&
    envClientSecret() &&
    envRefreshToken() &&
    envCustomerId()
  );
}

// ---------------------------------------------------------------------------
// OAuth2 access token with in-memory cache
// ---------------------------------------------------------------------------

let cachedAccessToken: string | null = null;
let cachedTokenExpiry = 0;

async function getGoogleAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedAccessToken && Date.now() < cachedTokenExpiry) {
    return cachedAccessToken;
  }

  const clientId = envClientId();
  const clientSecret = envClientSecret();
  const refreshToken = envRefreshToken();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Ads OAuth2 credentials not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Google OAuth2 token refresh failed (${res.status}): ${text.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    cachedAccessToken = data.access_token;
    // Cache with 60s safety buffer
    cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

    return cachedAccessToken;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// GAQL query helper via searchStream
// ---------------------------------------------------------------------------

const GOOGLE_ADS_BASE = "https://googleads.googleapis.com/v18";

async function googleAdsQuery<T>(
  customerId: string,
  query: string,
): Promise<T> {
  const accessToken = await getGoogleAccessToken();
  const developerToken = envDeveloperToken();

  if (!developerToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN not configured");

  const url = `${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:searchStream`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Google Ads API searchStream failed (${res.status}): ${text.slice(0, 300)}`,
      );
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Response types from searchStream
// ---------------------------------------------------------------------------

type SearchStreamResponse = Array<{
  results: Array<{
    campaign?: {
      id?: string;
      name?: string;
      status?: string;
      advertisingChannelType?: string;
      startDate?: string;
      endDate?: string;
    };
    campaignBudget?: {
      amountMicros?: string;
    };
    metrics?: {
      costMicros?: string;
      impressions?: string;
      clicks?: string;
      conversions?: number;
      conversionsValue?: number;
      costPerConversion?: number;
      ctr?: number;
    };
    customer?: {
      id?: string;
    };
  }>;
}>;

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function mapCampaignStatus(status: string | undefined): string {
  switch (status) {
    case "ENABLED":
      return "active";
    case "PAUSED":
      return "paused";
    case "REMOVED":
      return "completed";
    default:
      return (status || "unknown").toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Micros conversion helper
// ---------------------------------------------------------------------------

function microsToUnits(micros: string | undefined): number {
  return parseInt(micros || "0", 10) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Exported fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch all campaigns + their 30-day metrics from Google Ads.
 */
export async function fetchGoogleAdsCampaigns(): Promise<GoogleAdsCampaign[]> {
  const customerId = envCustomerId();
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const query = `
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign_budget.amount_micros,
           campaign.start_date, campaign.end_date,
           metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value,
           metrics.cost_per_conversion, metrics.ctr
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
  `.trim();

  const response = await googleAdsQuery<SearchStreamResponse>(customerId, query);

  // searchStream returns an array of batches, each with a results array
  const allResults = response.flatMap((batch) => batch.results || []);

  return allResults.map((row) => {
    const c = row.campaign || {};
    const m = row.metrics || {};
    const b = row.campaignBudget || {};

    const spend = microsToUnits(m.costMicros);
    const impressions = parseInt(m.impressions || "0", 10);
    const clicks = parseInt(m.clicks || "0", 10);
    const conversions = m.conversions || 0;
    const revenue = m.conversionsValue || 0;
    const cpc = spend > 0 && clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;
    const ctr = m.ctr || 0;
    const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;

    return {
      id: c.id || "",
      name: c.name || "",
      status: mapCampaignStatus(c.status),
      objective: c.advertisingChannelType || "unknown",
      dailyBudget: microsToUnits(b.amountMicros),
      startTime: c.startDate || null,
      stopTime: c.endDate || null,
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
 * Fetch account-level 30-day totals from Google Ads.
 */
export async function fetchGoogleAdsAccountInsights(): Promise<{
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number;
}> {
  const customerId = envCustomerId();
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const query = `
    SELECT metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value
    FROM customer
    WHERE segments.date DURING LAST_30_DAYS
  `.trim();

  const response = await googleAdsQuery<SearchStreamResponse>(customerId, query);

  const allResults = response.flatMap((batch) => batch.results || []);
  const row = allResults[0]?.metrics || {};

  const spend = microsToUnits(row.costMicros);
  const impressions = parseInt(row.impressions || "0", 10);
  const clicks = parseInt(row.clicks || "0", 10);
  const conversions = row.conversions || 0;
  const revenue = row.conversionsValue || 0;
  const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;

  return { spend, impressions, clicks, conversions, revenue, roas };
}
