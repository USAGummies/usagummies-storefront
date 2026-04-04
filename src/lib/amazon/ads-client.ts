/**
 * Amazon Advertising API Client — USA Gummies
 *
 * Wraps the Amazon Ads API for campaign management, keyword performance,
 * bid adjustments, and reporting.
 *
 * Auth: LWA OAuth 2.0 (same client credentials as SP-API, different scope)
 * Base URL: https://advertising-api.amazon.com (NA region)
 * Docs: https://advertising.amazon.com/API/docs/en-us
 */

const ADS_API_BASE = "https://advertising-api.amazon.com";

// ---------------------------------------------------------------------------
// Auth — LWA token exchange for Advertising API
// ---------------------------------------------------------------------------

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAdsAccessToken(): Promise<string | null> {
  const clientId = process.env.LWA_CLIENT_ID;
  const clientSecret = process.env.LWA_CLIENT_SECRET;
  const refreshToken = process.env.LWA_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn("[amazon-ads] Missing LWA credentials");
    return null;
  }

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.accessToken;
  }

  try {
    const res = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[amazon-ads] Token exchange failed:", res.status, text.slice(0, 200));
      return null;
    }

    const data = await res.json();
    cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
    return cachedToken.accessToken;
  } catch (err) {
    console.error("[amazon-ads] Token exchange error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Profile ID — required for all Ads API calls
// ---------------------------------------------------------------------------

let cachedProfileId: string | null = null;

async function getProfileId(accessToken: string): Promise<string | null> {
  if (cachedProfileId) return cachedProfileId;

  try {
    const res = await fetch(`${ADS_API_BASE}/v2/profiles`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Amazon-Advertising-API-ClientId": process.env.LWA_CLIENT_ID || "",
      },
    });

    if (!res.ok) {
      console.error("[amazon-ads] Profile fetch failed:", res.status);
      return null;
    }

    const profiles = await res.json();
    // Find US marketplace seller profile
    const sellerProfile = profiles.find(
      (p: { countryCode: string; accountInfo?: { type: string } }) =>
        p.countryCode === "US" && p.accountInfo?.type === "seller",
    ) || profiles[0];

    if (sellerProfile) {
      cachedProfileId = String(sellerProfile.profileId);
      return cachedProfileId;
    }

    console.warn("[amazon-ads] No profiles found");
    return null;
  } catch (err) {
    console.error("[amazon-ads] Profile fetch error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generic fetch wrapper
// ---------------------------------------------------------------------------

async function adsFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const accessToken = await getAdsAccessToken();
  if (!accessToken) return null;

  const profileId = await getProfileId(accessToken);
  if (!profileId) return null;

  const clientId = process.env.LWA_CLIENT_ID || "";

  try {
    const res = await fetch(`${ADS_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Amazon-Advertising-API-ClientId": clientId,
        "Amazon-Advertising-API-Scope": profileId,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init?.headers || {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[amazon-ads] ${init?.method || "GET"} ${path} failed: ${res.status} — ${text.slice(0, 300)}`);
      return null;
    }

    return (await res.json()) as T;
  } catch (err) {
    console.error(`[amazon-ads] ${path} error:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AdsCampaign = {
  campaignId: number;
  name: string;
  state: string;
  dailyBudget: number;
  startDate: string;
  endDate?: string;
  targetingType: string;
  [key: string]: unknown;
};

export type AdsKeyword = {
  keywordId: number;
  keywordText: string;
  matchType: string;
  state: string;
  bid: number;
  [key: string]: unknown;
};

/** List all Sponsored Products campaigns */
export async function listCampaigns(): Promise<AdsCampaign[] | null> {
  // Try v3 Sponsored Products API first
  const result = await adsFetch<AdsCampaign[]>("/sp/campaigns/list", {
    method: "POST",
    body: JSON.stringify({
      maxResults: 100,
    }),
  });

  if (result) return result;

  // Fallback to v2
  return adsFetch<AdsCampaign[]>("/v2/sp/campaigns");
}

/** List keywords/targets with performance */
export async function listKeywords(campaignId?: string): Promise<AdsKeyword[] | null> {
  const params = campaignId ? `?campaignIdFilter=${campaignId}` : "";
  return adsFetch<AdsKeyword[]>(`/v2/sp/keywords${params}`);
}

/** Adjust a keyword bid */
export async function updateBid(
  keywordId: string,
  bid: number,
): Promise<unknown> {
  return adsFetch("/v2/sp/keywords", {
    method: "PUT",
    body: JSON.stringify([{ keywordId: Number(keywordId), bid }]),
  });
}

/** Adjust a campaign budget */
export async function updateCampaignBudget(
  campaignId: string,
  dailyBudget: number,
): Promise<unknown> {
  return adsFetch("/v2/sp/campaigns", {
    method: "PUT",
    body: JSON.stringify([{ campaignId: Number(campaignId), dailyBudget }]),
  });
}

/** Request a performance report snapshot */
export async function requestReport(
  reportType: "campaigns" | "keywords" | "adGroups" = "campaigns",
  dateRange: "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "LAST_30_DAYS" = "LAST_7_DAYS",
): Promise<{ reportId: string } | null> {
  const metrics =
    reportType === "campaigns"
      ? "impressions,clicks,cost,attributedSales14d,attributedConversions14d"
      : "impressions,clicks,cost,attributedSales14d,attributedConversions14d,bid,keywordText";

  // Try v3 reporting endpoint
  const result = await adsFetch<{ reportId: string }>("/reporting/reports", {
    method: "POST",
    body: JSON.stringify({
      reportDate: dateRange,
      metrics: metrics.split(","),
      segment: [],
      creativeType: "SPONSORED_PRODUCTS",
    }),
  });

  if (result) return result;

  // Fallback to v2 snapshot report
  return adsFetch<{ reportId: string }>(`/v2/sp/${reportType}/report`, {
    method: "POST",
    body: JSON.stringify({
      reportDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      metrics,
    }),
  });
}

/** Download a completed report */
export async function getReport(reportId: string): Promise<unknown> {
  return adsFetch(`/v2/reports/${reportId}`);
}

/** Get profile info (for debugging) */
export async function getProfiles(): Promise<unknown> {
  const accessToken = await getAdsAccessToken();
  if (!accessToken) return null;

  const res = await fetch(`${ADS_API_BASE}/v2/profiles`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": process.env.LWA_CLIENT_ID || "",
    },
  });

  if (!res.ok) return null;
  return res.json();
}
