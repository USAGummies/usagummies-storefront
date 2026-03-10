/**
 * Abra Auto-Teach — Automated Knowledge Feeds
 *
 * Feeds are read from `abra_auto_teach_feeds` (v2 schema), with fallback
 * to legacy `abra_knowledge_feeds` during rollout.
 */

import { emitSignal } from "@/lib/ops/abra-operational-signals";

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
};

export type FeedResult = {
  feed_key: string;
  success: boolean;
  entriesCreated: number;
  error?: string;
};

type InventorySnapshotRow = {
  sku: string;
  on_hand: number;
  reorder_point: number;
  location?: string;
};

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

function parseJsonEnv<T>(key: string, fallback: T): T {
  const raw = process.env[key];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
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
        source_type: "auto_feed",
        source_ref: params.sourceRef,
        entry_type: "teaching",
        title: params.title,
        raw_text: params.rawText,
        summary_text: params.rawText.slice(0, 500),
        category: params.category,
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
    const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const shopifyToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    if (!shopifyDomain || !shopifyToken) {
      return {
        feed_key: feedKey,
        success: false,
        entriesCreated: 0,
        error: "Shopify not configured",
      };
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `https://${shopifyDomain}/admin/api/2024-10/orders.json?status=any&created_at_min=${since}&limit=50`;
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
    const orders = data.orders || [];
    if (orders.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const totalRevenue = orders.reduce(
      (sum: number, order: { total_price: string }) =>
        sum + parseFloat(order.total_price || "0"),
      0,
    );
    const date = new Date().toISOString().split("T")[0];
    const summary = `Shopify DTC Orders (${date}): ${orders.length} orders, $${totalRevenue.toFixed(2)} total revenue. Average order: $${(totalRevenue / orders.length).toFixed(2)}.`;
    const saved = await writeBrainEntry({
      sourceRef: `shopify-orders-${date}`,
      title: `Shopify Orders Summary — ${date}`,
      rawText: summary,
      category: "sales_data",
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
 * Placeholder feed handler — Amazon orders trend ingest.
 * TODO: Replace env-sample ingestion with SP-API integration.
 */
export async function handleAmazonOrdersFeed(): Promise<FeedResult> {
  const feedKey = "amazon_orders";
  try {
    const sample = parseJsonEnv<Array<{ order_id: string; total: number }>>(
      "ABRA_AMAZON_ORDERS_SAMPLE_JSON",
      [],
    );
    if (!Array.isArray(sample) || sample.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const total = sample.reduce((sum, order) => sum + (order.total || 0), 0);
    const summary = `Amazon orders snapshot: ${sample.length} orders, $${total.toFixed(2)} in sampled revenue.`;
    const date = new Date().toISOString().split("T")[0];
    const saved = await writeBrainEntry({
      sourceRef: `amazon-orders-${date}`,
      title: `Amazon Orders Trend — ${date}`,
      rawText: summary,
      category: "sales_data",
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
 * Placeholder feed handler — Faire wholesale orders ingest.
 * TODO: Replace env-sample ingestion with Faire API integration.
 */
export async function handleFaireOrdersFeed(): Promise<FeedResult> {
  const feedKey = "faire_orders";
  try {
    const sample = parseJsonEnv<Array<{ order_id: string; total: number }>>(
      "ABRA_FAIRE_ORDERS_SAMPLE_JSON",
      [],
    );
    if (!Array.isArray(sample) || sample.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const total = sample.reduce((sum, order) => sum + (order.total || 0), 0);
    const summary = `Faire orders snapshot: ${sample.length} wholesale orders, $${total.toFixed(2)} sampled revenue.`;
    const date = new Date().toISOString().split("T")[0];
    const saved = await writeBrainEntry({
      sourceRef: `faire-orders-${date}`,
      title: `Faire Orders Trend — ${date}`,
      rawText: summary,
      category: "sales_data",
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
    const sample = parseJsonEnv<Array<{ sku: string; title: string }>>(
      "ABRA_SHOPIFY_PRODUCTS_SAMPLE_JSON",
      [],
    );
    if (!Array.isArray(sample) || sample.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const summary = `Shopify catalog snapshot: ${sample.length} product records captured.`;
    const date = new Date().toISOString().split("T")[0];
    const saved = await writeBrainEntry({
      sourceRef: `shopify-products-${date}`,
      title: `Shopify Product Sync — ${date}`,
      rawText: summary,
      category: "operational",
      department: "operations",
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
 * Placeholder feed handler — GA4 traffic trend sync.
 * TODO: Replace env-sample ingestion with GA4 Reporting API call.
 */
export async function handleGA4TrafficFeed(): Promise<FeedResult> {
  const feedKey = "ga4_traffic";
  try {
    const sample = parseJsonEnv<{ sessions?: number; conversion_rate?: number }>(
      "ABRA_GA4_TRAFFIC_SAMPLE_JSON",
      {},
    );
    if (!sample.sessions) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const summary = `GA4 traffic snapshot: ${sample.sessions} sessions, conversion rate ${(sample.conversion_rate || 0).toFixed(2)}%.`;
    const date = new Date().toISOString().split("T")[0];
    const saved = await writeBrainEntry({
      sourceRef: `ga4-traffic-${date}`,
      title: `GA4 Traffic Summary — ${date}`,
      rawText: summary,
      category: "traffic_data",
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
 * Placeholder feed handler — inventory alerts and operational signal emit.
 * TODO: Replace env-sample ingestion with live inventory feed.
 */
export async function handleInventoryAlertsFeed(): Promise<FeedResult> {
  const feedKey = "inventory_alerts";
  try {
    const snapshot = parseJsonEnv<InventorySnapshotRow[]>(
      "ABRA_INVENTORY_SNAPSHOT_JSON",
      [],
    );

    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      return { feed_key: feedKey, success: true, entriesCreated: 0 };
    }

    const lowStock = snapshot.filter(
      (row) => row.on_hand <= row.reorder_point,
    );
    for (const item of lowStock.slice(0, 10)) {
      void emitSignal({
        signal_type: "inventory_alert",
        source: "inventory_feed",
        title: `Low stock: ${item.sku}`,
        detail: `${item.sku} on-hand ${item.on_hand} is below reorder point ${item.reorder_point}`,
        severity: item.on_hand <= Math.max(0, item.reorder_point * 0.5) ? "critical" : "warning",
        department: "supply_chain",
        metadata: {
          sku: item.sku,
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
      sourceRef: `inventory-alerts-${date}`,
      title: `Inventory Alert Summary — ${date}`,
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

async function patchFeedStatus(
  table: "abra_auto_teach_feeds" | "abra_knowledge_feeds",
  feedKey: string,
  result: FeedResult,
): Promise<boolean> {
  try {
    const body =
      table === "abra_auto_teach_feeds"
        ? {
            last_run_at: new Date().toISOString(),
            error_count: result.success ? 0 : 1,
          }
        : {
            last_run_at: new Date().toISOString(),
            last_status: result.success ? "success" : "error",
            last_error: result.error || null,
          };

    await sbFetch(`/rest/v1/${table}?feed_key=eq.${feedKey}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a generic feed by key. Dispatches to the appropriate handler.
 */
export async function runFeed(feedKey: string): Promise<FeedResult> {
  const handlers: Record<string, () => Promise<FeedResult>> = {
    shopify_orders: runShopifyOrdersFeed,
    amazon_orders: handleAmazonOrdersFeed,
    faire_orders: handleFaireOrdersFeed,
    shopify_products: handleShopifyProductsFeed,
    ga4_traffic: handleGA4TrafficFeed,
    inventory_alerts: handleInventoryAlertsFeed,
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
  const updatedV2 = await patchFeedStatus("abra_auto_teach_feeds", feedKey, result);
  if (!updatedV2) {
    void patchFeedStatus("abra_knowledge_feeds", feedKey, result);
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
