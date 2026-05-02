/**
 * I/O boundary for marketing-today: fetches platform inputs + approvals
 * so the API route + Slack handler share one fail-soft fetcher.
 *
 * Stays a thin wrapper — actual shape building is in `marketing-today.ts`.
 *
 * Each platform fetch is independently wrapped in try/catch. A
 * configured-but-thrown platform shows up as `{ configured: true,
 * fetchError, campaigns: [] }` so the aggregator surfaces it as
 * `error` (a real blocker) — distinct from the silent zero state.
 */
import {
  fetchMetaCampaigns,
  isMetaConfigured,
  type MetaCampaign,
} from "@/lib/ads/meta";
import { isGoogleAdsConfigured } from "@/lib/ads/google";
import { isTikTokConfigured } from "@/lib/ads/tiktok";

import type {
  MarketingCampaignInput,
  MarketingPlatformInput,
} from "./marketing-today";

export interface FetchMarketingPlatformsResult {
  platforms: MarketingPlatformInput[];
  degraded: string[];
}

/**
 * Fetch all configured ad platforms, fail-soft per platform.
 *
 * Note: Google + TikTok integrations don't have campaign fetchers
 * wired yet (config-only). They appear as `not_configured` when the
 * env vars are absent, or `configured_no_campaigns` when configured
 * but no fetcher is available — that's the truthful empty state.
 */
export async function fetchMarketingPlatforms(): Promise<FetchMarketingPlatformsResult> {
  const platforms: MarketingPlatformInput[] = [];
  const degraded: string[] = [];

  // Meta
  if (isMetaConfigured()) {
    try {
      const campaigns = await fetchMetaCampaigns();
      platforms.push({
        platform: "meta",
        configured: true,
        campaigns: campaigns.map(projectMetaCampaign),
        fetchError: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      platforms.push({
        platform: "meta",
        configured: true,
        campaigns: [],
        fetchError: msg,
      });
      degraded.push(`meta: ${msg}`);
    }
  } else {
    platforms.push({
      platform: "meta",
      configured: false,
      campaigns: [],
      fetchError: null,
    });
  }

  // Google + TikTok — config-only at this layer. When fetchers ship,
  // wire them here in the same try/catch shape.
  platforms.push({
    platform: "google",
    configured: isGoogleAdsConfigured(),
    campaigns: [],
    fetchError: null,
  });
  platforms.push({
    platform: "tiktok",
    configured: isTikTokConfigured(),
    campaigns: [],
    fetchError: null,
  });

  return { platforms, degraded };
}

/** Project a `MetaCampaign` row to the canonical input shape. */
function projectMetaCampaign(c: MetaCampaign): MarketingCampaignInput {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    spend: c.spend,
    impressions: c.impressions,
    clicks: c.clicks,
    conversions: c.conversions,
    revenue: c.revenue,
    roas: c.roas,
  };
}
