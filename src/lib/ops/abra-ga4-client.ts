import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";

export type GA4Report = {
  sessions: number;
  pageViews: number;
  users: number;
  avgEngagementTime: number;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; medium: string; sessions: number }>;
  bounceRate: number;
};

function asNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseServiceAccountJson(): Record<string, unknown> {
  const inline = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (inline) {
    try {
      return JSON.parse(inline) as Record<string, unknown>;
    } catch {
      // Multiline JSON in env vars is common — fall through to file path
      console.warn("[ga4] GA4_SERVICE_ACCOUNT_JSON is not valid JSON, trying file path fallback");
    }
  }

  const configuredPath = process.env.GA4_SERVICE_ACCOUNT_PATH;
  const defaultPath = path.join(
    process.env.HOME || "/Users/ben",
    ".config/usa-gummies-mcp/ga4-service-account.json",
  );
  const credentialPath = configuredPath || defaultPath;

  if (!fs.existsSync(credentialPath)) {
    throw new Error(
      `GA4 credentials missing. Set GA4_SERVICE_ACCOUNT_JSON or provide file at ${credentialPath}`,
    );
  }

  try {
    const text = fs.readFileSync(credentialPath, "utf8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse GA4 service account file at ${credentialPath}`);
  }
}

function getPropertyId(propertyId?: string): string {
  return propertyId || process.env.GA4_PROPERTY_ID || "509104328";
}

function getAnalyticsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: parseServiceAccountJson(),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });

  return google.analyticsdata({ version: "v1beta", auth });
}

export async function fetchGA4Report(params: {
  startDate: string;
  endDate: string;
  propertyId?: string;
}): Promise<GA4Report> {
  const property = `properties/${getPropertyId(params.propertyId)}`;
  const analyticsData = getAnalyticsClient();

  const [overview, pages, sources] = await Promise.all([
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "totalUsers" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
      },
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: "10",
      },
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
        dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: "10",
      },
    }),
  ]);

  const overviewMetrics = overview.data.rows?.[0]?.metricValues || [];
  const topPages = (pages.data.rows || []).map((row) => ({
    path: row.dimensionValues?.[0]?.value || "/",
    views: asNumber(row.metricValues?.[0]?.value),
  }));
  const topSources = (sources.data.rows || []).map((row) => ({
    source: row.dimensionValues?.[0]?.value || "(direct)",
    medium: row.dimensionValues?.[1]?.value || "(none)",
    sessions: asNumber(row.metricValues?.[0]?.value),
  }));

  return {
    sessions: asNumber(overviewMetrics[0]?.value),
    pageViews: asNumber(overviewMetrics[1]?.value),
    users: asNumber(overviewMetrics[2]?.value),
    avgEngagementTime: asNumber(overviewMetrics[3]?.value),
    bounceRate: asNumber(overviewMetrics[4]?.value),
    topPages,
    topSources,
  };
}

export async function fetchGA4Realtime(propertyId?: string): Promise<{
  activeUsers: number;
  topPages: Array<{ path: string; activeUsers: number }>;
}> {
  const property = `properties/${getPropertyId(propertyId)}`;
  const analyticsData = getAnalyticsClient();

  const realtime = await analyticsData.properties.runRealtimeReport({
    property,
    requestBody: {
      dimensions: [{ name: "unifiedPagePathScreen" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: "10",
    },
  });

  const rows = realtime.data.rows || [];
  const topPages = rows.map((row) => ({
    path: row.dimensionValues?.[0]?.value || "/",
    activeUsers: asNumber(row.metricValues?.[0]?.value),
  }));
  const activeUsers = topPages.reduce((sum, row) => sum + row.activeUsers, 0);

  return {
    activeUsers,
    topPages,
  };
}
