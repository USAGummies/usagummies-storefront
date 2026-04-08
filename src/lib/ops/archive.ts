/**
 * ARCHIVE — Notion Sync Engine for USA Gummies
 *
 * Centralized data backup: pulls from Shopify, QBO, and other sources,
 * writes snapshots to Notion databases. Idempotent — re-running never
 * creates duplicates (uses unique keys per record).
 *
 * Results persisted in Vercel KV under archive:* keys.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncSource =
  | "shopify"
  | "amazon"
  | "qbo"
  | "gmail"
  | "forge"
  | "freight"
  | "sessions";

export type SyncResult = {
  source: SyncSource;
  status: "success" | "error";
  rows_written: number;
  rows_skipped: number;
  error_message?: string;
  timestamp: string;
};

export type SyncReport = {
  run_id: string;
  started_at: string;
  completed_at: string;
  results: SyncResult[];
};

type SyncHealthEntry = {
  source: SyncSource;
  last_sync: string | null;
  status: "healthy" | "stale" | "never_synced" | "error";
  rows_last_written: number;
  staleness_hours: number | null;
};

export type SyncHealthReport = {
  checked_at: string;
  sources: SyncHealthEntry[];
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NOTION_VERSION = "2022-06-28";

// Notion DB IDs — from env vars or Viktor-provided defaults
const NOTION_DB_FINANCE_WEEKLY =
  process.env.NOTION_DB_QBO_FINANCIAL || "e450a386-95d7-4da0-97c7-bf503e0cbbaa";
const NOTION_DB_SALES_ACTIVITY =
  process.env.NOTION_DB_SALES_ACTIVITY || "e561190e-e045-428f-9644-1bd244eb686c";

// Optional DB IDs — skip sync if not configured
function getNotionDbId(source: SyncSource): string | null {
  switch (source) {
    case "shopify":
      return process.env.NOTION_DB_SHOPIFY_ORDERS || null;
    case "amazon":
      return process.env.NOTION_DB_AMAZON_FBA || null;
    case "qbo":
      return NOTION_DB_FINANCE_WEEKLY;
    case "sessions":
      return process.env.NOTION_DB_AGENT_SESSIONS || null;
    default:
      return null;
  }
}

function getNotionToken(): string | null {
  return process.env.NOTION_API_KEY || process.env.NOTION_TOKEN || null;
}

const KV_LAST_SYNC = "archive:last_sync";
const KV_SYNC_HISTORY = "archive:sync_history";
const STALENESS_THRESHOLD_HOURS = 48;

// ---------------------------------------------------------------------------
// Notion helpers
// ---------------------------------------------------------------------------

async function notionRequest(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
): Promise<unknown> {
  const token = getNotionToken();
  if (!token) throw new Error("Notion API key not configured");

  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Notion ${method} ${path} failed: ${res.status} — ${text.slice(0, 300)}`);
  }

  return res.json();
}

/**
 * Query a Notion database with a filter, returning all results.
 */
async function notionQueryDatabase(
  databaseId: string,
  filter?: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const body: Record<string, unknown> = {};
  if (filter) body.filter = filter;

  const result = (await notionRequest(
    `/databases/${databaseId}/query`,
    "POST",
    body,
  )) as { results: Array<Record<string, unknown>> };

  return result.results || [];
}

/**
 * Create a page (row) in a Notion database.
 */
async function notionCreatePage(
  databaseId: string,
  properties: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await notionRequest("/pages", "POST", {
    parent: { database_id: databaseId },
    properties,
  })) as Record<string, unknown>;
}

/**
 * Check if a row with a given unique key already exists in a Notion DB.
 * Uses the "unique_key" title property for dedup.
 */
async function notionRowExists(
  databaseId: string,
  uniqueKey: string,
): Promise<boolean> {
  // Try common title property names for dedup
  for (const prop of ["unique_key", "Name", "Order Number", "Week"]) {
    try {
      const filterType = prop === "unique_key" ? "rich_text" : "title";
      const results = await notionQueryDatabase(databaseId, {
        property: prop,
        [filterType]: { equals: uniqueKey },
      });
      if (results.length > 0) return true;
    } catch {
      // Property doesn't exist in this DB — try next
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Source: Shopify Orders -> Notion
// ---------------------------------------------------------------------------

export async function syncShopifyToNotion(): Promise<SyncResult> {
  const ts = new Date().toISOString();
  const dbId = getNotionDbId("shopify");

  if (!dbId) {
    return {
      source: "shopify",
      status: "error",
      rows_written: 0,
      rows_skipped: 0,
      error_message: "NOTION_DB_SHOPIFY_ORDERS not configured — skipping",
      timestamp: ts,
    };
  }

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    return {
      source: "shopify",
      status: "error",
      rows_written: 0,
      rows_skipped: 0,
      error_message: "SHOPIFY_ADMIN_TOKEN not configured",
      timestamp: ts,
    };
  }

  try {
    const res = await fetch(
      "https://usa-gummies.myshopify.com/admin/api/2024-01/orders.json?status=any&limit=50",
      {
        headers: { "X-Shopify-Access-Token": token },
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Shopify API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      orders: Array<{
        id: number;
        name: string;
        created_at: string;
        total_price: string;
        financial_status: string;
        fulfillment_status: string | null;
        customer?: { first_name?: string; last_name?: string; email?: string };
        line_items?: Array<{ title: string; quantity: number; price: string }>;
      }>;
    };

    let written = 0;
    let skipped = 0;

    for (const order of data.orders || []) {
      const uniqueKey = order.name; // e.g. "#1042"
      const exists = await notionRowExists(dbId, uniqueKey);

      if (exists) {
        skipped++;
        continue;
      }

      const customerName = order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
        : "Guest";

      const lineItemSummary = (order.line_items || [])
        .map((li) => `${li.title} x${li.quantity}`)
        .join(", ");

      await notionCreatePage(dbId, {
        Name: { title: [{ text: { content: order.name } }] },
        "Order Number": { rich_text: [{ text: { content: order.name } }] },
        "Order Date": { date: { start: order.created_at.split("T")[0] } },
        Total: { number: parseFloat(order.total_price) },
        "Financial Status": {
          select: { name: order.financial_status || "unknown" },
        },
        "Fulfillment Status": {
          select: { name: order.fulfillment_status || "unfulfilled" },
        },
        "Customer Name": { rich_text: [{ text: { content: customerName } }] },
        "Line Items": {
          rich_text: [{ text: { content: lineItemSummary.slice(0, 2000) } }],
        },
      });

      written++;
    }

    return {
      source: "shopify",
      status: "success",
      rows_written: written,
      rows_skipped: skipped,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source: "shopify",
      status: "error",
      rows_written: 0,
      rows_skipped: 0,
      error_message: err instanceof Error ? err.message : String(err),
      timestamp: ts,
    };
  }
}

// ---------------------------------------------------------------------------
// Source: QBO Weekly Snapshot -> Notion
// ---------------------------------------------------------------------------

export async function syncQBOToNotion(): Promise<SyncResult> {
  const ts = new Date().toISOString();
  const dbId = getNotionDbId("qbo");

  if (!dbId) {
    return {
      source: "qbo",
      status: "error",
      rows_written: 0,
      rows_skipped: 0,
      error_message: "No QBO Notion DB configured — set NOTION_DB_QBO_FINANCIAL or use default",
      timestamp: ts,
    };
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return {
      source: "qbo",
      status: "error",
      rows_written: 0,
      rows_skipped: 0,
      error_message: "CRON_SECRET not configured for internal QBO API calls",
      timestamp: ts,
    };
  }

  try {
    // Calculate week key for idempotency (ISO week)
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    const weekKey = `qbo-weekly-${weekStart.toISOString().split("T")[0]}`;

    // Check if this week's snapshot already exists
    const exists = await notionRowExists(dbId, weekKey);
    if (exists) {
      return {
        source: "qbo",
        status: "success",
        rows_written: 0,
        rows_skipped: 1,
        timestamp: new Date().toISOString(),
      };
    }

    // Determine the base URL for internal API calls
    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXTAUTH_URL || "http://localhost:3000";

    const headers = {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    };

    // Fetch P&L for current month
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const today = now.toISOString().split("T")[0];

    const [pnlRes, bsRes] = await Promise.all([
      fetch(
        `${baseUrl}/api/ops/qbo/query?type=pnl&start=${monthStart}&end=${today}`,
        { headers, signal: AbortSignal.timeout(30000) },
      ),
      fetch(
        `${baseUrl}/api/ops/qbo/query?type=balance_sheet`,
        { headers, signal: AbortSignal.timeout(30000) },
      ),
    ]);

    let pnlSummary = "P&L fetch failed";
    let bsSummary = "Balance Sheet fetch failed";
    let totalRevenue = 0;
    let totalExpenses = 0;
    let netIncome = 0;
    let cashPosition = 0;

    if (pnlRes.ok) {
      const pnlData = (await pnlRes.json()) as Record<string, unknown>;
      totalRevenue =
        typeof pnlData.totalRevenue === "number" ? pnlData.totalRevenue : 0;
      totalExpenses =
        typeof pnlData.totalExpenses === "number" ? pnlData.totalExpenses : 0;
      netIncome =
        typeof pnlData.netIncome === "number" ? pnlData.netIncome : 0;
      pnlSummary = `Rev: $${totalRevenue.toFixed(2)}, Exp: $${totalExpenses.toFixed(2)}, Net: $${netIncome.toFixed(2)}`;
    }

    if (bsRes.ok) {
      const bsData = (await bsRes.json()) as Record<string, unknown>;
      cashPosition =
        typeof bsData.cashPosition === "number" ? bsData.cashPosition : 0;
      bsSummary = `Cash: $${cashPosition.toFixed(2)}`;
    }

    await notionCreatePage(dbId, {
      Week: { title: [{ text: { content: weekKey } }] },
      "Week Start": { date: { start: weekStart.toISOString().split("T")[0] } },
      Revenue: { number: totalRevenue },
      "Operating Expenses": { number: totalExpenses },
      "Net Income": { number: netIncome },
      "Cash Balance": { number: cashPosition },
      Source: { select: { name: "QBO" } },
      Notes: {
        rich_text: [{ text: { content: `${pnlSummary} | ${bsSummary}`.slice(0, 2000) } }],
      },
    });

    return {
      source: "qbo",
      status: "success",
      rows_written: 1,
      rows_skipped: 0,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source: "qbo",
      status: "error",
      rows_written: 0,
      rows_skipped: 0,
      error_message: err instanceof Error ? err.message : String(err),
      timestamp: ts,
    };
  }
}

// ---------------------------------------------------------------------------
// Source: Sales Activity Log (placeholder for multi-channel sales)
// ---------------------------------------------------------------------------

async function syncSalesActivityToNotion(): Promise<SyncResult> {
  const ts = new Date().toISOString();
  const dbId = NOTION_DB_SALES_ACTIVITY;

  try {
    // For now, sales activity is synced from Shopify orders into the
    // Sales Activity Log DB as well, but with channel tagging.
    // Future: merge Amazon, Faire, wholesale data here.
    const token = process.env.SHOPIFY_ADMIN_TOKEN;
    if (!token) {
      return {
        source: "shopify",
        status: "error",
        rows_written: 0,
        rows_skipped: 0,
        error_message: "SHOPIFY_ADMIN_TOKEN not configured",
        timestamp: ts,
      };
    }

    const res = await fetch(
      "https://usa-gummies.myshopify.com/admin/api/2024-01/orders.json?status=any&limit=25&created_at_min=" +
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      {
        headers: { "X-Shopify-Access-Token": token },
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!res.ok) {
      throw new Error(`Shopify API ${res.status}`);
    }

    const data = (await res.json()) as {
      orders: Array<{
        id: number;
        name: string;
        created_at: string;
        total_price: string;
        financial_status: string;
      }>;
    };

    let written = 0;
    let skipped = 0;

    for (const order of data.orders || []) {
      const uniqueKey = `sale-shopify-${order.id}`;
      const exists = await notionRowExists(dbId, uniqueKey);

      if (exists) {
        skipped++;
        continue;
      }

      await notionCreatePage(dbId, {
        Name: { title: [{ text: { content: uniqueKey } }] },
        Channel: { select: { name: "Shopify DTC" } },
        "Order Ref": { rich_text: [{ text: { content: order.name } }] },
        Date: { date: { start: order.created_at.split("T")[0] } },
        Amount: { number: parseFloat(order.total_price) },
        "Financial Status": {
          select: { name: order.financial_status || "unknown" },
        },
      });

      written++;
    }

    return {
      source: "shopify",
      status: "success",
      rows_written: written,
      rows_skipped: skipped,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      source: "shopify",
      status: "error",
      rows_written: 0,
      rows_skipped: 0,
      error_message: err instanceof Error ? err.message : String(err),
      timestamp: ts,
    };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const ALL_SYNCABLE: SyncSource[] = ["shopify", "qbo"];

/**
 * Run sync for all (or specified) sources. Each source runs independently —
 * one failure does not block others.
 */
export async function syncAllSources(
  sources?: SyncSource[],
): Promise<SyncReport> {
  const runId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const toSync = sources || ALL_SYNCABLE;

  const results: SyncResult[] = [];

  for (const source of toSync) {
    let result: SyncResult;

    switch (source) {
      case "shopify":
        // Sync to both Shopify Orders DB and Sales Activity Log
        result = await syncShopifyToNotion();
        results.push(result);
        // Also sync to Sales Activity Log
        results.push(await syncSalesActivityToNotion());
        continue;
      case "qbo":
        result = await syncQBOToNotion();
        break;
      case "amazon":
      case "gmail":
      case "forge":
      case "freight":
      case "sessions":
        result = {
          source,
          status: "error",
          rows_written: 0,
          rows_skipped: 0,
          error_message: `${source} sync not yet implemented`,
          timestamp: new Date().toISOString(),
        };
        break;
      default:
        result = {
          source,
          status: "error",
          rows_written: 0,
          rows_skipped: 0,
          error_message: `Unknown source: ${source}`,
          timestamp: new Date().toISOString(),
        };
    }

    results.push(result);
  }

  const report: SyncReport = {
    run_id: runId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    results,
  };

  // Persist to KV
  try {
    await kv.set(KV_LAST_SYNC, report);

    // Append to history (keep last 50 runs)
    const history =
      (await kv.get<SyncReport[]>(KV_SYNC_HISTORY)) || [];
    history.unshift(report);
    if (history.length > 50) history.length = 50;
    await kv.set(KV_SYNC_HISTORY, history);
  } catch (err) {
    console.warn(
      "[archive] Failed to persist sync report to KV:",
      err instanceof Error ? err.message : err,
    );
  }

  return report;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Get the last sync report from Vercel KV.
 */
export async function getLastSyncReport(): Promise<SyncReport | null> {
  try {
    return await kv.get<SyncReport>(KV_LAST_SYNC);
  } catch {
    return null;
  }
}

/**
 * Check sync health — freshness of each source based on last sync time.
 */
export async function checkSyncHealth(): Promise<SyncHealthReport> {
  const lastReport = await getLastSyncReport();
  const now = new Date();

  const allSources: SyncSource[] = [
    "shopify",
    "amazon",
    "qbo",
    "gmail",
    "forge",
    "freight",
    "sessions",
  ];

  const sources: SyncHealthEntry[] = allSources.map((source) => {
    const result = lastReport?.results.find((r) => r.source === source);

    if (!result) {
      return {
        source,
        last_sync: null,
        status: "never_synced" as const,
        rows_last_written: 0,
        staleness_hours: null,
      };
    }

    const lastSync = new Date(result.timestamp);
    const hoursAgo =
      (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60);

    let status: SyncHealthEntry["status"];
    if (result.status === "error") {
      status = "error";
    } else if (hoursAgo > STALENESS_THRESHOLD_HOURS) {
      status = "stale";
    } else {
      status = "healthy";
    }

    return {
      source,
      last_sync: result.timestamp,
      status,
      rows_last_written: result.rows_written,
      staleness_hours: Math.round(hoursAgo * 10) / 10,
    };
  });

  return {
    checked_at: now.toISOString(),
    sources,
  };
}
