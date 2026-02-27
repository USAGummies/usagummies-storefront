/**
 * GET /api/ops/marketing — GA4 traffic data + marketing performance
 *
 * Fetches Google Analytics 4 data via the Analytics Data API:
 *   - Sessions, users, pageviews, bounce rate
 *   - Top pages, source/medium breakdown
 *   - Conversion funnel (sessions → add_to_cart → purchases)
 *   - Daily traffic trend
 *
 * Ad performance (Meta/Google/TikTok) is budget-ready but null until
 * ad accounts are connected.
 *
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || "509104328";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TrafficSource = {
  source: string;
  medium: string;
  sessions: number;
  users: number;
  pctOfTotal: number;
};

type TopPage = {
  path: string;
  title: string;
  pageviews: number;
  avgEngagementTime: number;
};

type DailyTraffic = {
  date: string;
  label: string;
  sessions: number;
  users: number;
  pageviews: number;
};

type ConversionFunnel = {
  sessions: number;
  addToCart: number;
  purchases: number;
  conversionRate: number;
  cartToCheckoutRate: number;
};

type AdChannel = {
  channel: string;
  spend: number;
  revenue: number;
  roas: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  /** Budget-ready: null until ad account connected + budget allocated */
  budget: number | null;
  utilizationPct: number | null;
};

type MarketingResponse = {
  overview: {
    sessions: number;
    users: number;
    pageviews: number;
    bounceRate: number;
    avgSessionDuration: number;
    newUserPct: number;
  };
  sources: TrafficSource[];
  topPages: TopPage[];
  dailyTraffic: DailyTraffic[];
  funnel: ConversionFunnel;
  adChannels: AdChannel[];
  generatedAt: string;
  /** Budget-ready: null until post-funding */
  budget: null;
};

// ---------------------------------------------------------------------------
// GA4 Auth
// ---------------------------------------------------------------------------

function isGA4Configured(): boolean {
  return !!(
    GA4_PROPERTY_ID &&
    (process.env.GA4_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS)
  );
}

function getAnalyticsClient() {
  const saJson = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const creds = JSON.parse(saJson);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    return google.analyticsdata({ version: "v1beta", auth });
  }

  // Fall back to application default credentials
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return google.analyticsdata({ version: "v1beta", auth });
}

// ---------------------------------------------------------------------------
// GA4 report helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchOverviewAndSources(
  client: ReturnType<typeof google.analyticsdata>,
  startDate: string,
  endDate: string,
) {
  const propertyId = `properties/${GA4_PROPERTY_ID}`;

  // Overview metrics
  const [overviewRes, sourcesRes, pagesRes, dailyRes] = await Promise.all([
    // Overall metrics
    client.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
          { name: "newUsers" },
        ],
      },
    }),

    // Source/medium breakdown
    client.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [
          { name: "sessionSource" },
          { name: "sessionMedium" },
        ],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: "15",
      },
    }),

    // Top pages
    client.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [
          { name: "pagePath" },
          { name: "pageTitle" },
        ],
        metrics: [
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
        ],
        orderBys: [
          { metric: { metricName: "screenPageViews" }, desc: true },
        ],
        limit: "20",
      },
    }),

    // Daily traffic
    client.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
        ],
        orderBys: [
          { dimension: { dimensionName: "date" }, desc: false },
        ],
      },
    }),
  ]);

  // Parse overview
  const overviewRow = overviewRes.data.rows?.[0];
  const oMetrics = overviewRow?.metricValues || [];
  const totalSessions = parseInt(oMetrics[0]?.value || "0", 10);
  const totalUsers = parseInt(oMetrics[1]?.value || "0", 10);
  const totalNewUsers = parseInt(oMetrics[5]?.value || "0", 10);

  const overview = {
    sessions: totalSessions,
    users: totalUsers,
    pageviews: parseInt(oMetrics[2]?.value || "0", 10),
    bounceRate: Math.round(parseFloat(oMetrics[3]?.value || "0") * 1000) / 10,
    avgSessionDuration: Math.round(
      parseFloat(oMetrics[4]?.value || "0") * 10,
    ) / 10,
    newUserPct:
      totalUsers > 0
        ? Math.round((totalNewUsers / totalUsers) * 1000) / 10
        : 0,
  };

  // Parse sources
  const sources: TrafficSource[] = (sourcesRes.data.rows || []).map((row) => {
    const dims = row.dimensionValues || [];
    const mets = row.metricValues || [];
    const sessions = parseInt(mets[0]?.value || "0", 10);
    return {
      source: dims[0]?.value || "(direct)",
      medium: dims[1]?.value || "(none)",
      sessions,
      users: parseInt(mets[1]?.value || "0", 10),
      pctOfTotal:
        totalSessions > 0
          ? Math.round((sessions / totalSessions) * 1000) / 10
          : 0,
    };
  });

  // Parse top pages
  const topPages: TopPage[] = (pagesRes.data.rows || []).map((row) => {
    const dims = row.dimensionValues || [];
    const mets = row.metricValues || [];
    return {
      path: dims[0]?.value || "/",
      title: dims[1]?.value || "",
      pageviews: parseInt(mets[0]?.value || "0", 10),
      avgEngagementTime: Math.round(
        parseFloat(mets[1]?.value || "0") * 10,
      ) / 10,
    };
  });

  // Parse daily traffic
  const dailyTraffic: DailyTraffic[] = (dailyRes.data.rows || []).map(
    (row) => {
      const dateStr = row.dimensionValues?.[0]?.value || "";
      const mets = row.metricValues || [];
      // GA4 returns dates as YYYYMMDD
      const year = dateStr.slice(0, 4);
      const month = dateStr.slice(4, 6);
      const day = dateStr.slice(6, 8);
      const isoDate = `${year}-${month}-${day}`;
      const d = new Date(isoDate + "T12:00:00Z");

      return {
        date: isoDate,
        label: d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        sessions: parseInt(mets[0]?.value || "0", 10),
        users: parseInt(mets[1]?.value || "0", 10),
        pageviews: parseInt(mets[2]?.value || "0", 10),
      };
    },
  );

  return { overview, sources, topPages, dailyTraffic };
}

// ---------------------------------------------------------------------------
// Conversion funnel (separate query)
// ---------------------------------------------------------------------------

async function fetchFunnel(
  client: ReturnType<typeof google.analyticsdata>,
  startDate: string,
  endDate: string,
): Promise<ConversionFunnel> {
  try {
    const propertyId = `properties/${GA4_PROPERTY_ID}`;

    const res = await client.properties.runReport({
      property: propertyId,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            inListFilter: {
              values: ["session_start", "add_to_cart", "purchase"],
            },
          },
        },
      },
    });

    const events: Record<string, number> = {};
    for (const row of res.data.rows || []) {
      const name = row.dimensionValues?.[0]?.value || "";
      const count = parseInt(row.metricValues?.[0]?.value || "0", 10);
      events[name] = count;
    }

    const sessions = events["session_start"] || 0;
    const addToCart = events["add_to_cart"] || 0;
    const purchases = events["purchase"] || 0;

    return {
      sessions,
      addToCart,
      purchases,
      conversionRate:
        sessions > 0
          ? Math.round((purchases / sessions) * 10000) / 100
          : 0,
      cartToCheckoutRate:
        addToCart > 0
          ? Math.round((purchases / addToCart) * 10000) / 100
          : 0,
    };
  } catch {
    return {
      sessions: 0,
      addToCart: 0,
      purchases: 0,
      conversionRate: 0,
      cartToCheckoutRate: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  if (!isGA4Configured()) {
    return NextResponse.json({
      overview: {
        sessions: 0,
        users: 0,
        pageviews: 0,
        bounceRate: 0,
        avgSessionDuration: 0,
        newUserPct: 0,
      },
      sources: [],
      topPages: [],
      dailyTraffic: [],
      funnel: {
        sessions: 0,
        addToCart: 0,
        purchases: 0,
        conversionRate: 0,
        cartToCheckoutRate: 0,
      },
      adChannels: [],
      generatedAt: new Date().toISOString(),
      budget: null,
      error: "GA4 not configured",
    } satisfies MarketingResponse & { error: string });
  }

  // Check cache
  const cached = await readState<CacheEnvelope<MarketingResponse> | null>(
    "marketing-cache",
    null,
  );
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const client = getAnalyticsClient();
    const endDate = formatDate(new Date());
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const startDate = formatDate(start);

    // Parallel fetch
    const [{ overview, sources, topPages, dailyTraffic }, funnel] =
      await Promise.all([
        fetchOverviewAndSources(client, startDate, endDate),
        fetchFunnel(client, startDate, endDate),
      ]);

    // Ad channels — empty until ad accounts connected
    // Budget-ready: each channel will have budget/utilization fields
    const adChannels: AdChannel[] = [];

    const result: MarketingResponse = {
      overview,
      sources,
      topPages,
      dailyTraffic,
      funnel,
      adChannels,
      generatedAt: new Date().toISOString(),
      budget: null,
    };

    // Cache
    await writeState("marketing-cache", {
      data: result,
      cachedAt: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[marketing] GA4 fetch failed:", err);
    return NextResponse.json(
      {
        overview: {
          sessions: 0,
          users: 0,
          pageviews: 0,
          bounceRate: 0,
          avgSessionDuration: 0,
          newUserPct: 0,
        },
        sources: [],
        topPages: [],
        dailyTraffic: [],
        funnel: {
          sessions: 0,
          addToCart: 0,
          purchases: 0,
          conversionRate: 0,
          cartToCheckoutRate: 0,
        },
        adChannels: [],
        generatedAt: new Date().toISOString(),
        budget: null,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
