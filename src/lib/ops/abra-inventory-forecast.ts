import {
  fetchOrderItems,
  fetchOrders,
  fetchFBAInventory,
  isAmazonConfigured,
  nowMinusBuffer,
} from "@/lib/amazon/sp-api";
import { emitSignal } from "@/lib/ops/abra-operational-signals";
import { proposeAndMaybeExecute } from "@/lib/ops/abra-actions";
import { recordKPI } from "@/lib/ops/abra-kpi-recorder";

export type InventoryForecast = {
  product_name: string;
  sku: string;
  channel: "shopify" | "amazon" | "total";
  current_stock: number;
  daily_sell_rate: number;
  days_until_stockout: number;
  reorder_point: number;
  suggested_reorder_qty: number;
  lead_time_days: number;
  urgency: "critical" | "warning" | "ok";
};

type StockRow = {
  product_name: string;
  sku: string;
  channel: "shopify" | "amazon";
  current_stock: number;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
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

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

function getShopifyConfig() {
  const store = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  return { store, token, version };
}

async function fetchShopifyInventory(): Promise<StockRow[]> {
  const { store, token, version } = getShopifyConfig();
  if (!store || !token) return [];

  const res = await fetch(
    `https://${store}/admin/api/${version}/products.json?status=active&limit=250`,
    {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) return [];
  const data = await res.json();
  const products = Array.isArray(data?.products)
    ? (data.products as Array<{
        title?: string;
        variants?: Array<{ sku?: string; inventory_quantity?: number }>;
      }>)
    : [];

  const rows: StockRow[] = [];
  for (const product of products) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    for (const variant of variants) {
      const sku = String(variant.sku || "").trim();
      if (!sku) continue;
      rows.push({
        product_name: product.title || sku,
        sku,
        channel: "shopify",
        current_stock: Math.max(0, Number(variant.inventory_quantity || 0)),
      });
    }
  }
  return rows;
}

async function fetchShopifySellRate(): Promise<Map<string, number>> {
  const { store, token, version } = getShopifyConfig();
  if (!store || !token) return new Map();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `https://${store}/admin/api/${version}/orders.json?status=any&created_at_min=${encodeURIComponent(since)}&limit=250`,
    {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) return new Map();

  const data = await res.json();
  const orders = Array.isArray(data?.orders)
    ? (data.orders as Array<{
        line_items?: Array<{ sku?: string; quantity?: number }>;
      }>)
    : [];

  const unitsBySku = new Map<string, number>();
  for (const order of orders) {
    const items = Array.isArray(order.line_items) ? order.line_items : [];
    for (const item of items) {
      const sku = String(item.sku || "").trim();
      if (!sku) continue;
      unitsBySku.set(sku, (unitsBySku.get(sku) || 0) + Number(item.quantity || 0));
    }
  }

  for (const [sku, qty] of unitsBySku.entries()) {
    unitsBySku.set(sku, qty / 14);
  }
  return unitsBySku;
}

async function fetchAmazonInventoryRows(): Promise<StockRow[]> {
  if (!isAmazonConfigured()) return [];
  const inv = await withTimeout(fetchFBAInventory(), 8000, {
    items: [],
    error: "timed out",
    errorAt: new Date().toISOString(),
    lastSuccessfulFetch: null,
  });
  const rows: StockRow[] = [];
  for (const item of inv.items || []) {
    const sku = String(item.sellerSku || item.fnSku || item.asin || "").trim();
    if (!sku) continue;
    rows.push({
      product_name: item.productName || sku,
      sku,
      channel: "amazon",
      current_stock: Math.max(0, Number(item.totalQuantity || 0)),
    });
  }
  return rows;
}

async function fetchAmazonSellRate(): Promise<Map<string, number>> {
  if (!isAmazonConfigured()) return new Map();
  const end = nowMinusBuffer();
  const start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  let orders: Awaited<ReturnType<typeof fetchOrders>> = [];
  try {
    orders = await withTimeout(fetchOrders(start, end), 9000, []);
  } catch {
    orders = [];
  }
  const unitsBySku = new Map<string, number>();

  for (const order of orders.slice(0, 40)) {
    try {
      const items = await fetchOrderItems(order.AmazonOrderId);
      for (const item of items) {
        const sku = String(item.SellerSKU || item.ASIN || "").trim();
        if (!sku) continue;
        unitsBySku.set(sku, (unitsBySku.get(sku) || 0) + Number(item.QuantityOrdered || 0));
      }
    } catch {
      // best-effort on per-order item retrieval
    }
  }

  for (const [sku, qty] of unitsBySku.entries()) {
    unitsBySku.set(sku, qty / 14);
  }
  return unitsBySku;
}

async function getLeadTimeDays(): Promise<number> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/product_config?config_key=eq.lead_time_days&select=config_value&limit=1",
    )) as Array<{ config_value?: string }>;
    const parsed = Number(rows[0]?.config_value || 21);
    if (!Number.isFinite(parsed) || parsed <= 0) return 21;
    return Math.round(parsed);
  } catch {
    return 21;
  }
}

function toForecast(row: StockRow, dailySellRate: number, leadTimeDays: number): InventoryForecast {
  const safeRate = Math.max(0, dailySellRate);
  const daysUntilStockout =
    safeRate > 0 ? round2(row.current_stock / safeRate) : Number.POSITIVE_INFINITY;
  const reorderPoint = round2(safeRate * leadTimeDays);
  const suggestedReorderQty = round2(safeRate * (leadTimeDays + 14));
  const urgency: InventoryForecast["urgency"] =
    daysUntilStockout < leadTimeDays
      ? "critical"
      : daysUntilStockout < leadTimeDays * 1.5
        ? "warning"
        : "ok";

  return {
    product_name: row.product_name,
    sku: row.sku,
    channel: row.channel,
    current_stock: row.current_stock,
    daily_sell_rate: round2(safeRate),
    days_until_stockout: daysUntilStockout,
    reorder_point: reorderPoint,
    suggested_reorder_qty: suggestedReorderQty,
    lead_time_days: leadTimeDays,
    urgency,
  };
}

export async function analyzeInventory(): Promise<InventoryForecast[]> {
  const [shopifyStock, amazonStock, shopifyRate, amazonRate, leadTimeDays] = await Promise.all([
    fetchShopifyInventory(),
    fetchAmazonInventoryRows(),
    fetchShopifySellRate(),
    fetchAmazonSellRate(),
    getLeadTimeDays(),
  ]);

  const channelRows = [...shopifyStock, ...amazonStock];
  const forecasts: InventoryForecast[] = [];

  for (const row of channelRows) {
    const dailyRate =
      row.channel === "shopify"
        ? shopifyRate.get(row.sku) || 0
        : amazonRate.get(row.sku) || 0;
    forecasts.push(toForecast(row, dailyRate, leadTimeDays));
  }

  const totals = new Map<
    string,
    { product_name: string; sku: string; current_stock: number; daily_sell_rate: number }
  >();

  for (const row of forecasts) {
    const existing = totals.get(row.sku);
    if (!existing) {
      totals.set(row.sku, {
        product_name: row.product_name,
        sku: row.sku,
        current_stock: row.current_stock,
        daily_sell_rate: row.daily_sell_rate,
      });
      continue;
    }
    existing.current_stock += row.current_stock;
    existing.daily_sell_rate += row.daily_sell_rate;
  }

  for (const total of totals.values()) {
    const totalRow: StockRow = {
      product_name: total.product_name,
      sku: total.sku,
      channel: "shopify",
      current_stock: total.current_stock,
    };
    const base = toForecast(totalRow, total.daily_sell_rate, leadTimeDays);
    forecasts.push({
      ...base,
      channel: "total",
    });
  }

  return forecasts.sort((a, b) => {
    const aDays = Number.isFinite(a.days_until_stockout) ? a.days_until_stockout : 1_000_000;
    const bDays = Number.isFinite(b.days_until_stockout) ? b.days_until_stockout : 1_000_000;
    return aDays - bDays;
  });
}

export async function checkAndAlertReorders(): Promise<{
  alerts_sent: number;
  proposals_created: number;
}> {
  const forecasts = await analyzeInventory();
  let alertsSent = 0;
  let proposalsCreated = 0;

  for (const item of forecasts) {
    if (item.channel !== "total") continue;
    if (item.urgency === "ok") continue;

    const stockoutText = Number.isFinite(item.days_until_stockout)
      ? `${item.days_until_stockout} days`
      : "unknown timeline";
    const severity = item.urgency === "critical" ? "critical" : "warning";

    const signalId = await emitSignal({
      signal_type: "inventory_alert",
      source: "inventory",
      title: `Low stock: ${item.product_name}`,
      detail: `Current: ${item.current_stock} units. Sell rate: ${item.daily_sell_rate}/day. Stockout in ${stockoutText}. Suggested reorder: ${Math.ceil(item.suggested_reorder_qty)} units.`,
      severity,
      department: "supply_chain",
      metadata: {
        sku: item.sku,
        current_stock: item.current_stock,
        daily_sell_rate: item.daily_sell_rate,
        days_until_stockout: item.days_until_stockout,
        reorder_point: item.reorder_point,
        suggested_reorder_qty: item.suggested_reorder_qty,
      },
    });
    if (signalId) alertsSent += 1;

    if (item.urgency === "critical") {
      try {
        const result = await proposeAndMaybeExecute({
          action_type: "create_task",
          title: `Reorder ${item.product_name}`,
          description: `Reorder ${item.product_name}: ${Math.ceil(item.suggested_reorder_qty)} units`,
          department: "supply_chain",
          risk_level: "low",
          requires_approval: true,
          confidence: 0.8,
          params: {
            title: `Reorder ${item.product_name}: ${Math.ceil(item.suggested_reorder_qty)} units`,
            description: `SKU: ${item.sku}. Stockout estimate: ${stockoutText}. Suggested quantity: ${Math.ceil(item.suggested_reorder_qty)} units.`,
            priority: "high",
            task_type: "inventory_reorder",
          },
        });
        if (result.approval_id) proposalsCreated += 1;
      } catch {
        // best-effort proposal creation
      }
    }

    try {
      await recordKPI({
        metric_name: `inventory_days_remaining_${item.sku.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`,
        value: Number.isFinite(item.days_until_stockout) ? item.days_until_stockout : 999,
        department: "supply_chain",
        source_system: "calculated",
        metric_group: "inventory",
        entity_ref: item.sku,
      });
    } catch {
      // best-effort KPI writes
    }
  }

  return {
    alerts_sent: alertsSent,
    proposals_created: proposalsCreated,
  };
}
