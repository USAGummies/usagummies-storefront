/**
 * Abra Auto-Teach — Automated Knowledge Feeds
 *
 * Feeds are read from `abra_auto_teach_feeds` (v2 schema), with fallback
 * to legacy `abra_knowledge_feeds` during rollout.
 */

import { emitSignal } from "@/lib/ops/abra-operational-signals";
import { recordKPI } from "@/lib/ops/abra-kpi-recorder";
import { notify } from "@/lib/ops/notify";

export type AutoTeachFeed = {
  id: string;
  feed_key: string;
  feed_name?: string;
  name?: string;
  source?: string;
  source_type?: string;
  handler_endpoint?: string;
  endpoint_config?: Record<string, unknown>;
  schedule_cron?: string;
  schedule?: string;
  is_active: boolean;
  last_run_at: string | null;
  last_status?: string | null;
  last_error?: string | null;
  error_count?: number;
  consecutive_failures?: number;
};

export type FeedResult = {
  feed_key: string;
  success: boolean;
  entriesCreated: number;
  error?: string;
};

export type DeadLetter = {
  id: string;
  feed_key: string;
  error_message: string | null;
  error_stack: string | null;
  feed_snapshot: Record<string, unknown> | null;
  retry_count: number;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
};

const ALLOWED_BRAIN_CATEGORIES = new Set([
  "market_intel",
  "financial",
  "operational",
  "regulatory",
  "customer_insight",
  "deal_data",
  "email_triage",
  "competitive",
  "research",
  "field_note",
  "system_log",
  "teaching",
  "general",
  "company_info",
  "product_info",
  "supply_chain",
  "sales",
  "founder",
  "culture",
]);

function normalizeBrainCategory(category: string): string {
  const normalized = String(category || "").trim().toLowerCase();
  if (ALLOWED_BRAIN_CATEGORIES.has(normalized)) return normalized;
  return "general";
}

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }

  return json;
}

async function buildEmbedding(text: string): Promise<number[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
      dimensions: 1536,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Embedding failed (${res.status})`);
  }

  const data = await res.json();
  return data?.data?.[0]?.embedding || [];
}

function normalizeFeed(raw: AutoTeachFeed): AutoTeachFeed {
  return {
    ...raw,
    feed_name: raw.feed_name || raw.name || raw.feed_key,
    source: raw.source || raw.source_type || "custom",
    schedule_cron: raw.schedule_cron || raw.schedule || "0 6 * * *",
  };
}

function inferCadence(scheduleRaw: string): "hourly" | "daily" | "weekly" {
  const schedule = scheduleRaw.toLowerCase();
  if (schedule.includes("hour")) return "hourly";
  if (schedule.includes("week")) return "weekly";
  if (schedule.includes("mon") || schedule.includes("tue") || schedule.includes("wed") || schedule.includes("thu") || schedule.includes("fri") || schedule.includes("sat") || schedule.includes("sun")) {
    return "weekly";
  }
  return "daily";
}

function isNotConfiguredMessage(message: string | undefined): boolean {
  if (!message) return false;
  return /not configured|missing .*creds?|credentials not configured|skipping/i.test(
    message,
  );
}

function isFeedDue(feed: AutoTeachFeed): boolean {
  if (!feed.last_run_at) return true;
  const lastRun = new Date(feed.last_run_at).getTime();
  if (!Number.isFinite(lastRun)) return true;
  const hoursAgo = (Date.now() - lastRun) / (1000 * 60 * 60);
  const cadence = inferCadence(feed.schedule_cron || "daily");
  if (cadence === "hourly") return hoursAgo >= 0.9;
  if (cadence === "weekly") return hoursAgo >= 160;
  return hoursAgo >= 22;
}

async function getAutoTeachFeeds(): Promise<AutoTeachFeed[] | null> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_auto_teach_feeds?is_active=eq.true&select=*",
    )) as AutoTeachFeed[];
    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeFeed);
  } catch {
    return null;
  }
}

async function getLegacyFeeds(): Promise<AutoTeachFeed[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_knowledge_feeds?is_active=eq.true&select=*",
    )) as AutoTeachFeed[];
    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeFeed);
  } catch {
    return [];
  }
}

/**
 * Get active feeds that are due to run.
 */
export async function getDueFeeds(): Promise<AutoTeachFeed[]> {
  const v2Feeds = await getAutoTeachFeeds();
  const feeds = v2Feeds ?? (await getLegacyFeeds());
  return feeds.filter(isFeedDue);
}

/**
 * Write a teaching entry to the brain.
 */
async function writeBrainEntry(params: {
  sourceRef: string;
  title: string;
  rawText: string;
  category: string;
  department: string;
}): Promise<boolean> {
  try {
    const embedding = await buildEmbedding(
      `${params.title}\n${params.rawText}`,
    );

    await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "api",
        source_ref: params.sourceRef,
        entry_type: "teaching",
        title: params.title,
        raw_text: params.rawText,
        summary_text: params.rawText.slice(0, 500),
        category: normalizeBrainCategory(params.category),
        department: params.department,
        confidence: "medium",
        priority: "normal",
        processed: true,
        embedding,
      }),
    });

    return true;
  } catch (error) {
    console.error(
      "[auto-teach] Failed to write brain entry:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Run the Shopify orders feed — summarizes recent orders.
 */
export async function runShopifyOrdersFeed(): Promise<FeedResult> {
  const feedKey = "shopify_orders";
  try {
    const shopifyDomain =
      process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
    const shopifyToken =
      process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const shopifyVersion = process.env.SHOPIFY_API_VERSION || "2024-10";
    if (!shopifyDomain || !shopifyToken) {
      return {
        feed_key: feedKey,
        success: true,
        entriesCreated: 0,
        error: "Shopify not configured",
      };
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `https://${shopifyDomain}/admin/api/${shopifyVersion}/orders.json?status=any&created_at_min=${since}&limit=250`;
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": shopifyToken,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return {
        feed_key: feedKey,
        success: false,
        entriesCreated: 0,
        error: `Shopify API ${res.status}`,
      };
    }

    const data = await res.json();
    const orders = Array.isArray(data.orders)
      ? (data.orders as Array<{
          id?: number;
          name?: string;
          total_price?: string;
          customer?: { id?: number; orders_count?: number | string };
          line_items?: Array<{ quantity?: number }>;
        }>)
      : [];
    if (orders.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const totalRevenue = orders.reduce((sum, order) => {
      return sum + parseFloat(order.total_price || "0");
    }, 0);
    const largeOrders = orders.filter(
      (order) => parseFloat(order.total_price || "0") > 100,
    );
    let newCustomers = 0;
    let returningCustomers = 0;
    for (const order of orders) {
      const count = Number(order.customer?.orders_count || 0);
      if (Number.isFinite(count) && count > 1) {
        returningCustomers += 1;
      } else {
        newCustomers += 1;
      }
    }
    const date = new Date().toISOString().split("T")[0];
    const summary = `Shopify DTC Orders (${date}): ${orders.length} orders, $${totalRevenue.toFixed(2)} total revenue. Average order: $${(totalRevenue / orders.length).toFixed(2)}. Customers: ${newCustomers} new, ${returningCustomers} returning. Large orders (>$100): ${largeOrders.length}.`;
    const saved = await writeBrainEntry({
      sourceRef: `shopify-orders-${date}`,
      title: `Shopify Orders Summary — ${date}`,
      rawText: summary,
      category: "sales",
      department: "sales_and_growth",
    });

    for (const order of largeOrders.slice(0, 25)) {
      const amount = parseFloat(order.total_price || "0");
      void emitSignal({
        signal_type: "large_order",
        source: "shopify",
        title: `Large Shopify order: $${amount.toFixed(2)}`,
        detail: `Order ${order.name || order.id || "unknown"} exceeded $100`,
        severity: amount >= 300 ? "warning" : "info",
        department: "sales_and_growth",
        metadata: {
          order_id: order.id || null,
          order_name: order.name || null,
          amount,
        },
      });
    }

    try {
      await Promise.all([
        recordKPI({
          metric_name: "daily_revenue_shopify",
          value: totalRevenue,
          department: "sales_and_growth",
          source_system: "shopify",
          metric_group: "sales",
          entity_ref: "shopify",
        }),
        recordKPI({
          metric_name: "daily_orders_shopify",
          value: orders.length,
          department: "sales_and_growth",
          source_system: "shopify",
          metric_group: "sales",
          entity_ref: "shopify",
        }),
        recordKPI({
          metric_name: "daily_aov",
          value: orders.length > 0 ? totalRevenue / orders.length : 0,
          department: "sales_and_growth",
          source_system: "shopify",
          metric_group: "sales",
          entity_ref: "shopify",
        }),
      ]);
    } catch {
      // KPI recording is best-effort for feed continuity.
    }

    return { feed_key: feedKey, success: true, entriesCreated: saved ? 1 : 0 };
  } catch (error) {
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Placeholder feed handler — Amazon orders trend ingest.
 * TODO: Replace env-sample ingestion with SP-API integration.
 */
export async function handleAmazonOrdersFeed(): Promise<FeedResult> {
  const feedKey = "amazon_orders";
  try {
    const { fetchAmazonOrderStats, fetchOrders, isAmazonConfigured } = await import(
      "@/lib/amazon/sp-api"
    );
    if (!isAmazonConfigured()) {
      return {
        feed_key: feedKey,
        success: true,
        entriesCreated: 0,
        error: "Amazon not configured",
      };
    }
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    let orders: Array<{
      AmazonOrderId?: string;
      OrderTotal?: { Amount?: string };
      NumberOfItemsShipped?: number;
      NumberOfItemsUnshipped?: number;
    }> = [];

    try {
      const fetched = await fetchOrders(yesterday, now);
      orders = Array.isArray(fetched) ? fetched : [];
    } catch {
      const stats = await fetchAmazonOrderStats(1);
      const text = `Amazon (last 24h via stats): ${stats.totalOrders} orders, $${stats.totalRevenue.toFixed(2)} revenue.`;
      const saved = await writeBrainEntry({
        sourceRef: `amazon-orders-${new Date().toISOString().split("T")[0]}`,
        title: `Amazon Orders Summary — ${new Date().toISOString().split("T")[0]}`,
        rawText: text,
        category: "sales",
        department: "sales_and_growth",
      });
      void updateIntHealth("amazon", true);
      return {
        feed_key: feedKey,
        success: true,
        entriesCreated: saved ? 1 : 0,
      };
    }

    if (orders.length === 0) {
      void updateIntHealth("amazon", true);
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const revenue = orders.reduce((sum, order) => {
      return sum + parseFloat(order.OrderTotal?.Amount || "0");
    }, 0);
    const summary = `Amazon orders (last 24h): ${orders.length} orders, $${revenue.toFixed(2)} total revenue. Marketplace: US.`;
    const date = new Date().toISOString().split("T")[0];
    const saved = await writeBrainEntry({
      sourceRef: `amazon-orders-${date}`,
      title: `Amazon Orders Summary — ${date}`,
      rawText: summary,
      category: "sales",
      department: "sales_and_growth",
    });

    for (const order of orders) {
      const amount = parseFloat(order.OrderTotal?.Amount || "0");
      if (amount > 50) {
        void emitSignal({
          signal_type: "large_order",
          source: "amazon",
          title: `Large Amazon order: $${amount.toFixed(2)}`,
          detail: `Order ${order.AmazonOrderId || "unknown"} — ${order.NumberOfItemsShipped || order.NumberOfItemsUnshipped || "?"} items`,
          severity: amount > 200 ? "warning" : "info",
          department: "sales_and_growth",
          metadata: {
            order_id: order.AmazonOrderId || null,
            amount,
          },
        });
      }
    }

    try {
      await Promise.all([
        recordKPI({
          metric_name: "daily_revenue_amazon",
          value: revenue,
          department: "sales_and_growth",
          source_system: "amazon",
          metric_group: "sales",
          entity_ref: "amazon",
        }),
        recordKPI({
          metric_name: "daily_orders_amazon",
          value: orders.length,
          department: "sales_and_growth",
          source_system: "amazon",
          metric_group: "sales",
          entity_ref: "amazon",
        }),
      ]);
    } catch {
      // best-effort
    }

    void updateIntHealth("amazon", true);
    return { feed_key: feedKey, success: true, entriesCreated: saved ? 1 : 0 };
  } catch (error) {
    void updateIntHealth(
      "amazon",
      false,
      error instanceof Error ? error.message : String(error),
    );
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function handleAmazonInventoryFeed(): Promise<FeedResult> {
  const feedKey = "amazon_inventory";
  try {
    const { fetchFBAInventory, isAmazonConfigured } = await import(
      "@/lib/amazon/sp-api"
    );
    if (!isAmazonConfigured()) {
      return {
        feed_key: feedKey,
        success: true,
        entriesCreated: 0,
        error: "Amazon not configured",
      };
    }
    const result = await fetchFBAInventory();
    const items = Array.isArray(result.items)
      ? (result.items as Array<{
          asin?: string;
          fnSku?: string;
          totalQuantity?: number;
        }>)
      : [];

    if (items.length === 0) {
      void updateIntHealth("amazon", !result.error, result.error || undefined);
      return {
        feed_key: feedKey,
        success: !result.error,
        entriesCreated: 0,
        error: result.error || undefined,
      };
    }

    let lowStockCount = 0;
    for (const item of items) {
      const qty = Number(item.totalQuantity || 0);
      if (qty < 50) {
        lowStockCount += 1;
        void emitSignal({
          signal_type: "inventory_alert",
          source: "amazon",
          title: `Low FBA stock: ${item.fnSku || item.asin || "unknown"}`,
          detail: `${qty} units at FBA. ASIN: ${item.asin || "unknown"}`,
          severity: qty < 10 ? "critical" : "warning",
          department: "supply_chain",
          metadata: {
            asin: item.asin || null,
            fn_sku: item.fnSku || null,
            quantity: qty,
          },
        });
      }
    }

    const text = `Amazon FBA inventory: ${items.length} SKUs tracked. ${lowStockCount} below safety stock.`;
    const saved = await writeBrainEntry({
      sourceRef: `amazon-inventory-${new Date().toISOString().split("T")[0]}`,
      title: `Amazon FBA Inventory Snapshot — ${new Date().toISOString().split("T")[0]}`,
      rawText: text,
      category: "supply_chain",
      department: "supply_chain",
    });

    void updateIntHealth("amazon", true, result.error || undefined);
    return {
      feed_key: feedKey,
      success: true,
      entriesCreated: saved ? 1 : 0,
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (error) {
    void updateIntHealth(
      "amazon",
      false,
      error instanceof Error ? error.message : String(error),
    );
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Placeholder feed handler — Faire wholesale orders ingest.
 * TODO: Replace env-sample ingestion with Faire API integration.
 */
export async function handleFaireOrdersFeed(): Promise<FeedResult> {
  const feedKey = "faire_orders";
  try {
    const { fetchFaireOrders, isFaireConfigured } = await import(
      "@/lib/ops/abra-faire-client"
    );
    const hasCreds = isFaireConfigured();
    const orders = await fetchFaireOrders({
      since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    if (!hasCreds && orders.length === 0) {
      return {
        feed_key: feedKey,
        success: true,
        entriesCreated: 0,
        error: "Faire credentials not configured",
      };
    }

    if (orders.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const total = orders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0),
      0,
    );
    const summary = `Faire orders (last 24h): ${orders.length} wholesale orders, $${total.toFixed(2)} revenue.`;
    const date = new Date().toISOString().split("T")[0];
    const saved = await writeBrainEntry({
      sourceRef: `faire-orders-${date}`,
      title: `Faire Orders Trend — ${date}`,
      rawText: summary,
      category: "sales",
      department: "sales_and_growth",
    });
    return { feed_key: feedKey, success: true, entriesCreated: saved ? 1 : 0 };
  } catch (error) {
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Placeholder feed handler — Shopify catalog sync.
 * TODO: Replace env-sample ingestion with Admin API product sync.
 */
export async function handleShopifyProductsFeed(): Promise<FeedResult> {
  const feedKey = "shopify_products";
  try {
    const store = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
    const token =
      process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const version = process.env.SHOPIFY_API_VERSION || "2024-10";
    if (!store || !token) {
      return {
        feed_key: feedKey,
        success: true,
        entriesCreated: 0,
        error: "Missing Shopify creds",
      };
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `https://${store}/admin/api/${version}/products.json?updated_at_min=${encodeURIComponent(since)}&limit=250`;
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`Shopify products ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const products = Array.isArray(data?.products)
      ? (data.products as Array<{
          id?: number;
          title?: string;
          product_type?: string;
          status?: string;
          variants?: Array<{
            price?: string;
            inventory_quantity?: number;
          }>;
        }>)
      : [];

    if (products.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    let created = 0;
    for (const product of products) {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const totalInventory = variants.reduce(
        (sum, variant) => sum + Number(variant.inventory_quantity || 0),
        0,
      );
      const firstPrice = variants[0]?.price || "?";
      const text = `Product update: "${product.title || "Untitled"}" (${product.product_type || "uncategorized"}). ${variants.length} variants. Total inventory: ${totalInventory}. Status: ${product.status || "unknown"}. Price range: $${firstPrice}.`;

      const saved = await writeBrainEntry({
        sourceRef: `shopify-product-${product.id || "unknown"}-${new Date().toISOString().split("T")[0]}`,
        title: `Shopify Product Update — ${product.title || product.id || "Unknown"}`,
        rawText: text,
        category: "product_info",
        department: "operations",
      });
      if (saved) created += 1;

      if ((product.status || "").toLowerCase() === "active" && totalInventory < 100) {
        void emitSignal({
          signal_type: "inventory_alert",
          source: "shopify",
          title: `Low inventory: ${product.title || product.id || "Unknown product"}`,
          detail: `Only ${totalInventory} units remaining across ${variants.length} variants`,
          severity: totalInventory < 25 ? "critical" : "warning",
          department: "supply_chain",
          metadata: {
            product_id: product.id || null,
            title: product.title || null,
            inventory: totalInventory,
          },
        });
      }
    }

    return { feed_key: feedKey, success: true, entriesCreated: created };
  } catch (error) {
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Placeholder feed handler — GA4 traffic trend sync.
 * TODO: Replace env-sample ingestion with GA4 Reporting API call.
 */
export async function handleGA4TrafficFeed(): Promise<FeedResult> {
  const feedKey = "ga4_traffic";
  try {
    if (
      !process.env.GA4_SERVICE_ACCOUNT_JSON &&
      !process.env.GA4_SERVICE_ACCOUNT_PATH
    ) {
      return {
        feed_key: feedKey,
        success: true,
        entriesCreated: 0,
        error: "GA4 not configured",
      };
    }
    const { fetchGA4Report } = await import("@/lib/ops/abra-ga4-client");
    const report = await fetchGA4Report({
      startDate: "yesterday",
      endDate: "yesterday",
    });
    const topPagesStr = report.topPages
      .slice(0, 5)
      .map((page) => `${page.path} (${page.views})`)
      .join(", ");
    const topSourcesStr = report.topSources
      .slice(0, 3)
      .map(
        (source) => `${source.source}/${source.medium} (${source.sessions})`,
      )
      .join(", ");

    const summary = `GA4 traffic (yesterday): ${report.sessions} sessions, ${report.pageViews} pageviews, ${report.users} users. Avg engagement: ${report.avgEngagementTime.toFixed(0)}s. Bounce rate: ${(report.bounceRate * 100).toFixed(1)}%. Top pages: ${topPagesStr}. Top sources: ${topSourcesStr}.`;
    const date = new Date().toISOString().split("T")[0];
    const saved = await writeBrainEntry({
      sourceRef: `ga4-traffic-${date}`,
      title: `GA4 Traffic Summary — ${date}`,
      rawText: summary,
      category: "market_intel",
      department: "sales_and_growth",
    });

    if (report.sessions < 10) {
      void emitSignal({
        signal_type: "traffic_anomaly",
        source: "ga4",
        title: "Unusually low traffic",
        detail: `Only ${report.sessions} sessions yesterday (expected 50+)`,
        severity: "warning",
        department: "sales_and_growth",
        metadata: { sessions: report.sessions },
      });
    }

    try {
      await Promise.all([
        recordKPI({
          metric_name: "daily_sessions",
          value: report.sessions,
          department: "sales_and_growth",
          source_system: "calculated",
          metric_group: "operations",
          entity_ref: "ga4",
        }),
        recordKPI({
          metric_name: "daily_pageviews",
          value: report.pageViews,
          department: "sales_and_growth",
          source_system: "calculated",
          metric_group: "operations",
          entity_ref: "ga4",
        }),
      ]);
    } catch {
      // best-effort
    }

    return { feed_key: feedKey, success: true, entriesCreated: saved ? 1 : 0 };
  } catch (error) {
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function handleEmailFetchFeed(): Promise<FeedResult> {
  const feedKey = "email_fetch";
  try {
    const { runEmailFetch } = await import("@/lib/ops/abra-email-fetch");
    const result = await runEmailFetch({ count: 50 });
    return {
      feed_key: feedKey,
      success: true,
      entriesCreated: result.inserted,
      ...(result.note ? { error: result.note } : {}),
    };
  } catch (error) {
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Placeholder feed handler — inventory alerts and operational signal emit.
 * TODO: Replace env-sample ingestion with live inventory feed.
 */
export async function handleInventoryAlertsFeed(): Promise<FeedResult> {
  return handleShopifyInventoryFeed();
}

export async function handleInventoryForecastFeed(): Promise<FeedResult> {
  const feedKey = "inventory_forecast";
  try {
    const { checkAndAlertReorders } = await import("@/lib/ops/abra-inventory-forecast");
    const result = await checkAndAlertReorders();
    return {
      feed_key: feedKey,
      success: true,
      entriesCreated: result.alerts_sent,
      ...(result.proposals_created > 0
        ? { error: `proposals_created=${result.proposals_created}` }
        : {}),
    };
  } catch (error) {
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function handlePipelineHealthFeed(): Promise<FeedResult> {
  const feedKey = "pipeline_health";
  try {
    const { syncNotionDeals, checkDealHealth } = await import(
      "@/lib/ops/abra-pipeline-intelligence"
    );
    await syncNotionDeals();
    const result = await checkDealHealth();
    return {
      feed_key: feedKey,
      success: true,
      entriesCreated: result.signals_emitted,
      ...(result.proposals_created > 0
        ? { error: `proposals_created=${result.proposals_created}` }
        : {}),
    };
  } catch (error) {
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Shopify inventory monitor feed.
 */
export async function handleShopifyInventoryFeed(): Promise<FeedResult> {
  const feedKey = "inventory_alerts";
  try {
    const store = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
    const token =
      process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const version = process.env.SHOPIFY_API_VERSION || "2024-10";
    if (!store || !token) {
      return {
        feed_key: feedKey,
        success: true,
        entriesCreated: 0,
        error: "Missing Shopify creds",
      };
    }

    const url = `https://${store}/admin/api/${version}/products.json?status=active&limit=250`;
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`Shopify inventory ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const products = Array.isArray(data?.products)
      ? (data.products as Array<{
          id?: number;
          title?: string;
          variants?: Array<{ sku?: string; inventory_quantity?: number }>;
        }>)
      : [];

    if (products.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const safetyStock = 75;
    const criticalStock = 20;
    const lowStock = products
      .map((product) => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        const onHand = variants.reduce(
          (sum, variant) => sum + Number(variant.inventory_quantity || 0),
          0,
        );
        return {
          sku: variants[0]?.sku || String(product.id || "unknown"),
          on_hand: onHand,
          reorder_point: safetyStock,
          location: "shopify",
          title: product.title || "Unknown product",
          product_id: product.id || null,
          variant_count: variants.length,
        };
      })
      .filter((row) => row.on_hand <= row.reorder_point);

    for (const item of lowStock.slice(0, 10)) {
      void emitSignal({
        signal_type: "inventory_alert",
        source: "shopify",
        title: `Low stock: ${item.title}`,
        detail: `${item.sku} on-hand ${item.on_hand} is below safety stock ${item.reorder_point}`,
        severity: item.on_hand <= criticalStock ? "critical" : "warning",
        department: "supply_chain",
        metadata: {
          sku: item.sku,
          product_id: item.product_id,
          title: item.title,
          variant_count: item.variant_count,
          on_hand: item.on_hand,
          reorder_point: item.reorder_point,
          location: item.location || null,
        },
      });
    }

    if (lowStock.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const summary = `Inventory alerts: ${lowStock.length} SKUs below reorder point (${lowStock.map((item) => item.sku).join(", ")}).`;
    const date = new Date().toISOString().split("T")[0];
    const saved = await writeBrainEntry({
      sourceRef: `shopify-inventory-${date}`,
      title: `Shopify Inventory Summary — ${date}`,
      rawText: summary,
      category: "operational",
      department: "supply_chain",
    });
    return { feed_key: feedKey, success: true, entriesCreated: saved ? 1 : 0 };
  } catch (error) {
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function getFeedState(feedKey: string): Promise<{
  id: string;
  feed_key: string;
  is_active: boolean;
  consecutive_failures: number;
} | null> {
  try {
    const rows = (await sbFetch(
      `/rest/v1/abra_auto_teach_feeds?feed_key=eq.${feedKey}&select=id,feed_key,is_active,consecutive_failures&limit=1`,
    )) as Array<{
      id: string;
      feed_key: string;
      is_active: boolean;
      consecutive_failures: number | null;
    }>;
    const row = rows?.[0];
    if (!row) return null;
    return {
      id: row.id,
      feed_key: row.feed_key,
      is_active: !!row.is_active,
      consecutive_failures: Number(row.consecutive_failures || 0),
    };
  } catch {
    return null;
  }
}

async function patchAutoTeachFeedStatus(params: {
  feedKey: string;
  result: FeedResult;
  consecutiveFailures: number;
  disableFeed: boolean;
}): Promise<boolean> {
  try {
    await sbFetch(`/rest/v1/abra_auto_teach_feeds?feed_key=eq.${params.feedKey}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        last_run_at: new Date().toISOString(),
        error_count: params.result.success ? 0 : 1,
        last_status: params.result.success ? "success" : "error",
        last_error: params.result.error || null,
        consecutive_failures: params.consecutiveFailures,
        ...(params.disableFeed ? { is_active: false } : {}),
      }),
    });
    return true;
  } catch {
    return false;
  }
}

async function patchLegacyFeedStatus(
  feedKey: string,
  result: FeedResult,
): Promise<boolean> {
  try {
    await sbFetch(`/rest/v1/abra_knowledge_feeds?feed_key=eq.${feedKey}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        last_run_at: new Date().toISOString(),
        last_status: result.success ? "success" : "error",
        last_error: result.error || null,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

async function writeDeadLetter(
  feedKey: string,
  error: string,
  stack?: string,
  snapshot?: Record<string, unknown>,
): Promise<void> {
  try {
    await sbFetch("/rest/v1/abra_feed_dead_letters", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          feed_key: feedKey,
          error_message: error.slice(0, 1000),
          error_stack: stack ? stack.slice(0, 2000) : null,
          feed_snapshot: snapshot || null,
        },
      ]),
    });
  } catch {
    // best-effort
  }
}

export async function getUnresolvedDeadLetters(): Promise<DeadLetter[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_feed_dead_letters?resolved=eq.false&select=id,feed_key,error_message,error_stack,feed_snapshot,retry_count,resolved,resolved_at,created_at&order=created_at.desc&limit=100",
    )) as DeadLetter[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function resolveDeadLetter(id: string): Promise<boolean> {
  try {
    await sbFetch(`/rest/v1/abra_feed_dead_letters?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resolved: true,
        resolved_at: new Date().toISOString(),
      }),
    });
    return true;
  } catch {
    return false;
  }
}

function integrationSystemForFeed(feedKey: string): string | null {
  if (
    feedKey === "shopify_orders" ||
    feedKey === "shopify_products" ||
    feedKey === "shopify_inventory" ||
    feedKey === "inventory_alerts"
  ) {
    return "shopify";
  }
  if (feedKey === "amazon_orders" || feedKey === "amazon_inventory") {
    return "amazon";
  }
  if (feedKey === "ga4_traffic") return "ga4_analytics";
  if (feedKey === "faire_orders") return "faire";
  if (feedKey === "email_fetch") return "gmail";
  return null;
}

async function updateIntHealth(
  systemName: string,
  success: boolean,
  error?: string,
): Promise<void> {
  try {
    const notConfigured = isNotConfiguredMessage(error);
    const connectionStatus = notConfigured
      ? "not_configured"
      : success
        ? "connected"
        : "error";
    const payload = {
      system_name: systemName,
      connection_status: connectionStatus,
      ...(connectionStatus === "connected"
        ? {
            last_success_at: new Date().toISOString(),
            error_summary: null,
            retry_count: 0,
          }
        : connectionStatus === "not_configured"
          ? {
              error_summary: error || "Integration not configured",
            }
        : {
            last_error_at: new Date().toISOString(),
            error_summary: (error || "Unknown feed failure").slice(0, 500),
          }),
      updated_at: new Date().toISOString(),
    };
    await sbFetch("/rest/v1/integration_health?on_conflict=system_name", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([payload]),
    });
  } catch {
    // best-effort
  }
}

/**
 * Run a generic feed by key. Dispatches to the appropriate handler.
 */
export async function runFeed(feedKey: string): Promise<FeedResult> {
  const handlers: Record<string, () => Promise<FeedResult>> = {
    shopify_orders: runShopifyOrdersFeed,
    amazon_orders: handleAmazonOrdersFeed,
    amazon_inventory: handleAmazonInventoryFeed,
    faire_orders: handleFaireOrdersFeed,
    shopify_products: handleShopifyProductsFeed,
    shopify_inventory: handleShopifyInventoryFeed,
    ga4_traffic: handleGA4TrafficFeed,
    email_fetch: handleEmailFetchFeed,
    inventory_alerts: handleInventoryAlertsFeed,
    inventory_forecast: handleInventoryForecastFeed,
    pipeline_health: handlePipelineHealthFeed,
  };

  const handler = handlers[feedKey];
  if (!handler) {
    return {
      feed_key: feedKey,
      success: false,
      entriesCreated: 0,
      error: `No handler for feed: ${feedKey}`,
    };
  }

  const result = await handler();
  const state = await getFeedState(feedKey);
  const shouldCountFailure = !result.success && !isNotConfiguredMessage(result.error);
  const consecutiveFailures = shouldCountFailure
    ? (state?.consecutive_failures || 0) + 1
    : 0;
  const disableFeed = shouldCountFailure && consecutiveFailures >= 5;

  const updatedV2 = await patchAutoTeachFeedStatus({
    feedKey,
    result,
    consecutiveFailures,
    disableFeed,
  });
  if (!updatedV2) {
    void patchLegacyFeedStatus(feedKey, result);
  }

  if (!result.success) {
    const errorText = result.error || "Unknown feed failure";
    await writeDeadLetter(feedKey, errorText, undefined, {
      result,
      consecutive_failures: consecutiveFailures,
      disabled: disableFeed,
    });
  }

  if (disableFeed && state?.is_active !== false) {
    const errorText = result.error || "Unknown feed failure";
    void notify({
      channel: "alerts",
      text: `🚨 Feed ${feedKey} disabled after ${consecutiveFailures} consecutive failures: ${errorText}`,
    });
  }

  const systemName = integrationSystemForFeed(feedKey);
  if (systemName) {
    void updateIntHealth(systemName, result.success, result.error);
  }
  return result;
}

/**
 * Run all due feeds. Called by ABRA9 agent.
 */
export async function runAllDueFeeds(): Promise<FeedResult[]> {
  const dueFeeds = await getDueFeeds();
  if (dueFeeds.length === 0) {
    console.log("[auto-teach] No feeds due to run.");
    return [];
  }

  console.log(
    `[auto-teach] Running ${dueFeeds.length} due feeds: ${dueFeeds.map((feed) => feed.feed_key).join(", ")}`,
  );

  const results: FeedResult[] = [];
  for (const feed of dueFeeds) {
    const result = await runFeed(feed.feed_key);
    results.push(result);
    console.log(
      `[auto-teach] ${feed.feed_key}: ${result.success ? "OK" : "FAILED"} (${result.entriesCreated} entries)`,
    );
  }

  return results;
}

export async function runAutoTeachCycle(): Promise<FeedResult[]> {
  return runAllDueFeeds();
}
