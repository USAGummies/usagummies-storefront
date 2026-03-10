/**
 * Amazon SP-API SDK — USA Gummies
 *
 * Ported from the proven pattern in scripts/daily-report.mjs.
 * Handles LWA OAuth token exchange, Orders API, FBA Inventory, and Fee estimates.
 *
 * Env vars required:
 *   LWA_CLIENT_ID, LWA_CLIENT_SECRET, LWA_REFRESH_TOKEN,
 *   MARKETPLACE_ID, SP_API_ENDPOINT
 */

import type {
  AmazonOrder,
  AmazonOrderItem,
  FBAInventorySummary,
  FeeEstimate,
  FinancialEventGroup,
} from "./types";
import { getCachedInventory, setCachedInventory, getCachedKPIs as getCachedKPIsFromCache } from "./cache";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LWA_CLIENT_ID = () => process.env.LWA_CLIENT_ID || "";
const LWA_CLIENT_SECRET = () => process.env.LWA_CLIENT_SECRET || "";
const LWA_REFRESH_TOKEN = () => process.env.LWA_REFRESH_TOKEN || "";
const MARKETPLACE_ID = () => process.env.MARKETPLACE_ID || "ATVPDKIKX0DER";
const SP_API_ENDPOINT = () =>
  process.env.SP_API_ENDPOINT || "https://sellingpartnerapi-na.amazon.com";
const AMAZON_PRIMARY_ASIN = () => process.env.AMAZON_PRIMARY_ASIN || "B0G1JK92TJ";

/** Check if Amazon SP-API credentials are configured */
export function isAmazonConfigured(): boolean {
  return !!(LWA_CLIENT_ID() && LWA_CLIENT_SECRET() && LWA_REFRESH_TOKEN());
}

// ---------------------------------------------------------------------------
// LWA Token Exchange (in-memory cache, 50-min TTL)
// ---------------------------------------------------------------------------

let _cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (50 min TTL, tokens last 60 min)
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) {
    return _cachedToken.token;
  }

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: LWA_REFRESH_TOKEN(),
      client_id: LWA_CLIENT_ID(),
      client_secret: LWA_CLIENT_SECRET(),
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    let parsedMessage = text;
    try {
      const parsed = JSON.parse(text) as {
        error_description?: string;
        error?: string;
      };
      parsedMessage = parsed.error_description || parsed.error || text;
    } catch {
      // Use raw text when response is not JSON.
    }
    throw new Error(
      `LWA token exchange failed (${res.status}): ${parsedMessage.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("LWA token exchange returned no access_token");
  }

  // Cache for 50 minutes (tokens are valid for 60)
  _cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };

  return data.access_token;
}

// ---------------------------------------------------------------------------
// Generic SP-API GET with rate limit retry
// ---------------------------------------------------------------------------

async function spApiGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, SP_API_ENDPOINT());
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Re-fetch token on each attempt to handle expiration during retries
      const accessToken = await getAccessToken();
      const res = await fetch(url.toString(), {
        headers: {
          "x-amz-access-token": accessToken,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20000),
      });

      if (res.status === 429) {
        // Rate limited — wait and retry
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 403) {
          if (path.includes("/orders/v0/orders")) {
            throw new Error(
              `SP-API Orders 403 — check IAM role or app registration. Raw: ${text.slice(0, 200)}`,
            );
          }
          throw new Error(
            `SP-API ${path}: 403 Forbidden — The SP-API app lacks the required role/scope for this endpoint. ` +
              `Re-authorize the app in Amazon Seller Central → Apps & Services → Develop Apps → Edit App → Add required API sections (e.g., FBA Inventory). ` +
              `Raw: ${text.slice(0, 200)}`,
          );
        }
        throw new Error(`SP-API ${path} failed: ${res.status} — ${text}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) await sleep(2000 * (attempt + 1));
    }
  }

  throw lastError || new Error(`SP-API ${path} failed after 3 attempts`);
}

async function spApiPost<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const accessToken = await getAccessToken();
  const url = new URL(path, SP_API_ENDPOINT());

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SP-API POST ${path} failed: ${res.status} — ${text}`);
  }

  return (await res.json()) as T;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Orders API
// ---------------------------------------------------------------------------

type OrdersResponse = {
  payload?: {
    Orders: AmazonOrder[];
    NextToken?: string;
  };
  errors?: { code: string; message: string }[];
};

/**
 * Fetch orders created within a time range. Handles NextToken pagination.
 * Dates should be ISO 8601 strings.
 */
export async function fetchOrders(
  createdAfter: string,
  createdBefore: string,
): Promise<AmazonOrder[]> {
  const allOrders: AmazonOrder[] = [];
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = nextToken
      ? { NextToken: nextToken }
      : {
          MarketplaceIds: MARKETPLACE_ID(),
          CreatedAfter: createdAfter,
          CreatedBefore: createdBefore,
        };

    const res = await spApiGet<OrdersResponse>("/orders/v0/orders", params);

    if (res.errors?.length) {
      console.error("[amazon] Orders API errors:", JSON.stringify(res.errors));
      break;
    }

    if (res.payload?.Orders) {
      allOrders.push(...res.payload.Orders);
    }

    nextToken = res.payload?.NextToken;

    // Respect rate limit: 1 request per 5 seconds for orders
    if (nextToken) await sleep(5500);
  } while (nextToken);

  return allOrders;
}

type OrderItemsResponse = {
  payload?: {
    OrderItems: AmazonOrderItem[];
    NextToken?: string;
  };
  errors?: { code: string; message: string }[];
};

/**
 * Fetch line items for a specific order. Used to get unit counts.
 */
export async function fetchOrderItems(
  orderId: string,
): Promise<AmazonOrderItem[]> {
  const res = await spApiGet<OrderItemsResponse>(
    `/orders/v0/orders/${orderId}/orderItems`,
  );

  if (res.errors?.length) {
    console.error(`[amazon] OrderItems errors for ${orderId}:`, JSON.stringify(res.errors));
    return [];
  }

  return res.payload?.OrderItems || [];
}

// ---------------------------------------------------------------------------
// FBA Inventory API
// ---------------------------------------------------------------------------

type InventoryResponse = {
  payload?: {
    inventorySummaries: FBAInventorySummary[];
  };
  errors?: { code: string; message: string }[];
};

export type FBAInventoryFetchResult = {
  items: FBAInventorySummary[];
  error: string | null;
  errorAt: string | null;
  lastSuccessfulFetch: string | null;
};

export async function testAmazonConnection(): Promise<{
  configured: boolean;
  tokenOk: boolean;
  ordersOk: boolean;
  inventoryOk: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  if (!isAmazonConfigured()) {
    return {
      configured: false,
      tokenOk: false,
      ordersOk: false,
      inventoryOk: false,
      errors: ["SP-API env vars not set"],
    };
  }

  let tokenOk = false;
  try {
    await getAccessToken();
    tokenOk = true;
  } catch (error) {
    errors.push(`Token: ${error instanceof Error ? error.message : String(error)}`);
  }

  let ordersOk = false;
  try {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await fetchOrders(dayAgo.toISOString(), now.toISOString());
    ordersOk = true;
  } catch (error) {
    errors.push(
      `Orders: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let inventoryOk = false;
  try {
    const inv = await fetchFBAInventory();
    inventoryOk = !inv.error;
    if (inv.error) errors.push(`Inventory: ${inv.error}`);
  } catch (error) {
    errors.push(
      `Inventory: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { configured: true, tokenOk, ordersOk, inventoryOk, errors };
}

/**
 * Fetch FBA inventory summaries with full details.
 */
export async function fetchFBAInventory(): Promise<FBAInventoryFetchResult> {
  const cached = await getCachedInventory<FBAInventoryFetchResult>();
  try {
    const res = await spApiGet<InventoryResponse>(
      "/fba/inventory/v1/summaries",
      {
        details: "true",
        granularityType: "Marketplace",
        granularityId: MARKETPLACE_ID(),
        marketplaceIds: MARKETPLACE_ID(),
      },
    );

    if (res.errors?.length) {
      const errorText = `Inventory API errors: ${JSON.stringify(res.errors)}`;
      console.error("[amazon] " + errorText);
      return {
        items: cached?.items || [],
        error: errorText,
        errorAt: new Date().toISOString(),
        lastSuccessfulFetch: cached?.lastSuccessfulFetch || null,
      };
    }

    const items = res.payload?.inventorySummaries || [];
    const payload: FBAInventoryFetchResult = {
      items,
      error: null,
      errorAt: null,
      lastSuccessfulFetch: new Date().toISOString(),
    };
    await setCachedInventory(payload);
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[amazon] FBA Inventory fetch failed:", message);
    return {
      items: cached?.items || [],
      error: message,
      errorAt: new Date().toISOString(),
      lastSuccessfulFetch: cached?.lastSuccessfulFetch || null,
    };
  }
}

export const getCachedKPIs = getCachedKPIsFromCache;

// ---------------------------------------------------------------------------
// Orders-based Amazon stats (fallback when FBA Inventory API is 403)
// ---------------------------------------------------------------------------

export type AmazonOrderStats = {
  totalOrders: number;
  totalUnits: number;
  totalRevenue: number;
  fbaOrders: number;
  fbmOrders: number;
  dailyVelocity: number;
  monthlyBreakdown: { month: string; orders: number; units: number; revenue: number }[];
  periodDays: number;
  source: "orders-api";
};

/**
 * Fetch Amazon order stats from the working Orders API.
 * Uses this as a fallback when FBA Inventory API is blocked (403).
 * Returns order volume, units, revenue, and velocity.
 */
export async function fetchAmazonOrderStats(
  daysBack = 60,
): Promise<AmazonOrderStats> {
  const createdAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const createdBefore = nowMinusBuffer();

  const orders = await fetchOrders(createdAfter, createdBefore);

  const totalOrders = orders.length;
  const fbaOrders = orders.filter(o => o.FulfillmentChannel === "AFN").length;
  const fbmOrders = orders.filter(o => o.FulfillmentChannel === "MFN").length;
  const totalUnits = orders.reduce(
    (sum, o) => sum + (o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0),
    0,
  );
  const totalRevenue = orders.reduce(
    (sum, o) => sum + parseFloat(o.OrderTotal?.Amount || "0"),
    0,
  );

  // Monthly breakdown
  const byMonth: Record<string, { orders: number; units: number; revenue: number }> = {};
  for (const o of orders) {
    const month = o.PurchaseDate?.substring(0, 7) || "unknown";
    if (!byMonth[month]) byMonth[month] = { orders: 0, units: 0, revenue: 0 };
    byMonth[month].orders++;
    byMonth[month].units += (o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0);
    byMonth[month].revenue += parseFloat(o.OrderTotal?.Amount || "0");
  }

  const monthlyBreakdown = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));

  const dailyVelocity = daysBack > 0 ? totalUnits / daysBack : 0;

  return {
    totalOrders,
    totalUnits,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    fbaOrders,
    fbmOrders,
    dailyVelocity: Math.round(dailyVelocity * 100) / 100,
    monthlyBreakdown,
    periodDays: daysBack,
    source: "orders-api",
  };
}

// ---------------------------------------------------------------------------
// Fees API
// ---------------------------------------------------------------------------

type FeesResponse = {
  payload?: {
    FeesEstimateResult?: {
      FeesEstimate?: {
        FeeDetailList?: {
          FeeType: string;
          FinalFee: { CurrencyCode: string; Amount: number };
          FeeAmount: { CurrencyCode: string; Amount: number };
          FeePromotion?: { CurrencyCode: string; Amount: number };
        }[];
        TotalFeesEstimate?: { CurrencyCode: string; Amount: number };
      };
      Status?: string;
      Error?: { Type: string; Code: string; Message: string };
    };
  };
};

/**
 * Estimate Amazon fees for the primary ASIN at a given price.
 */
export async function fetchFeesEstimate(
  price: number,
  asin?: string,
): Promise<FeeEstimate> {
  const targetAsin = asin || AMAZON_PRIMARY_ASIN();

  try {
    const res = await spApiPost<FeesResponse>(
      `/products/fees/v0/items/${targetAsin}/feesEstimate`,
      {
        FeesEstimateRequest: {
          MarketplaceId: MARKETPLACE_ID(),
          IsAmazonFulfilled: true,
          PriceToEstimateFees: {
            ListingPrice: { CurrencyCode: "USD", Amount: price },
          },
          Identifier: `fee-est-${Date.now()}`,
        },
      },
    );

    const result = res.payload?.FeesEstimateResult;
    if (result?.Error) {
      console.error("[amazon] Fees API error:", result.Error.Message);
      return fallbackFeeEstimate(price);
    }

    const feeList = result?.FeesEstimate?.FeeDetailList || [];
    let referralFee = 0;
    let fbaFee = 0;
    let closingFee = 0;

    for (const fee of feeList) {
      const amt = fee.FinalFee?.Amount || 0;
      if (fee.FeeType === "ReferralFee") referralFee = amt;
      else if (fee.FeeType === "FBAFees") fbaFee = amt;
      else if (fee.FeeType === "VariableClosingFee") closingFee = amt;
    }

    const totalFee = result?.FeesEstimate?.TotalFeesEstimate?.Amount || (referralFee + fbaFee + closingFee);

    return {
      referralFee,
      fbaFee,
      closingFee,
      totalFee,
      netPerUnit: price - totalFee,
    };
  } catch (err) {
    console.error("[amazon] Fees estimate failed:", err);
    return fallbackFeeEstimate(price);
  }
}

/**
 * Fallback fee estimate when API fails — uses typical ~15% referral + FBA rates.
 */
function fallbackFeeEstimate(price: number): FeeEstimate {
  const referralFee = price * 0.15;
  const fbaFee = 5.0; // Rough estimate for typical supplement size
  const totalFee = referralFee + fbaFee;
  return {
    referralFee,
    fbaFee,
    closingFee: 0,
    totalFee,
    netPerUnit: price - totalFee,
  };
}

// ---------------------------------------------------------------------------
// Finances API — Settlement Event Groups
// ---------------------------------------------------------------------------

type FinancialEventGroupsResponse = {
  payload?: {
    FinancialEventGroupList: FinancialEventGroup[];
    NextToken?: string;
  };
  errors?: { code: string; message: string }[];
};

/**
 * Fetch financial event groups (settlement periods) from Amazon.
 * Returns settlement info including pending balance and recent transfers.
 */
export async function fetchFinancialEventGroups(
  financialEventGroupStartedAfter?: string,
  financialEventGroupStartedBefore?: string,
): Promise<FinancialEventGroup[]> {
  try {
    const params: Record<string, string> = {
      MaxResultsPerPage: "10",
    };
    if (financialEventGroupStartedAfter) {
      params.FinancialEventGroupStartedAfter = financialEventGroupStartedAfter;
    }
    if (financialEventGroupStartedBefore) {
      params.FinancialEventGroupStartedBefore = financialEventGroupStartedBefore;
    }

    const res = await spApiGet<FinancialEventGroupsResponse>(
      "/finances/v0/financialEventGroups",
      params,
    );

    if (res.errors?.length) {
      console.error("[amazon] Finances API errors:", JSON.stringify(res.errors));
      return [];
    }

    const groups = res.payload?.FinancialEventGroupList || [];
    return groups;
  } catch (err) {
    console.error("[amazon] Financial event groups fetch failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Date helpers (PT-aware, DST-safe for Vercel UTC servers)
// ---------------------------------------------------------------------------

/**
 * Detect current Pacific Time UTC offset (handles PST/PDT correctly).
 * PST = UTC-8 (Nov-Mar), PDT = UTC-7 (Mar-Nov)
 */
function ptOffset(): string {
  // Create a date formatter that gives us the PT offset
  const now = new Date();
  const ptTimeStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const ptDate = new Date(ptTimeStr);
  const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const diffHours = Math.round((utcDate.getTime() - ptDate.getTime()) / (60 * 60 * 1000));
  return diffHours === 8 ? "-08:00" : "-07:00";
}

/**
 * Get a YYYY-MM-DD date string in Pacific Time, offset by N days.
 * Uses toLocaleDateString with LA timezone — safe on UTC servers (Vercel).
 */
export function ptDate(daysAgo = 0): string {
  const target = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return target.toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

/**
 * Get ISO timestamp for start of day in Pacific Time (DST-aware).
 */
export function ptDateISO(daysAgo = 0): string {
  return `${ptDate(daysAgo)}T00:00:00${ptOffset()}`;
}

/**
 * Get "now minus 3 min" ISO — Amazon requires CreatedBefore to be in the past.
 */
export function nowMinusBuffer(): string {
  return new Date(Date.now() - 3 * 60 * 1000).toISOString();
}

/**
 * Get the start of the current week (Monday) in PT.
 * Derives day-of-week from the PT date string directly (safe on UTC servers).
 */
export function weekStartPT(): string {
  const now = new Date();
  const ptString = now.toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  // Parse components to avoid timezone-shifting bugs
  const [year, month, day] = ptString.split("-").map(Number);
  // Use UTC methods to avoid local timezone influence
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = dt.getUTCDay(); // 0=Sun, 1=Mon...
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Days since Monday
  dt.setUTCDate(dt.getUTCDate() - diff);
  const dateStr = dt.toISOString().slice(0, 10);
  return `${dateStr}T00:00:00${ptOffset()}`;
}

/**
 * Get the start of last week (Monday) in PT.
 */
export function lastWeekStartPT(): string {
  const now = new Date();
  const ptString = now.toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  const [year, month, day] = ptString.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = dt.getUTCDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  dt.setUTCDate(dt.getUTCDate() - diff - 7);
  const dateStr = dt.toISOString().slice(0, 10);
  return `${dateStr}T00:00:00${ptOffset()}`;
}

/**
 * Get the start of the current month in PT.
 */
export function monthStartPT(): string {
  const now = new Date();
  const ptString = now.toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  return ptString.slice(0, 8) + `01T00:00:00${ptOffset()}`;
}

/**
 * Fetch orders for multiple date ranges sequentially to respect rate limits.
 * Returns results in the same order as the input ranges.
 */
export async function fetchOrdersSequential(
  ranges: { after: string; before: string }[],
): Promise<AmazonOrder[][]> {
  const results: AmazonOrder[][] = [];
  for (const range of ranges) {
    results.push(await fetchOrders(range.after, range.before));
    // Small delay between separate queries to avoid burst
    if (ranges.indexOf(range) < ranges.length - 1) {
      await sleep(1500);
    }
  }
  return results;
}
