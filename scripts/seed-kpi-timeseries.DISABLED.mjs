#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const ENV_PATH = resolve(PROJECT_ROOT, ".env.local");

function parseEnvLocal(content) {
  const env = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function getEnv() {
  const parsed = parseEnvLocal(readFileSync(ENV_PATH, "utf8"));
  const baseUrl = parsed.SUPABASE_URL || parsed.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = parsed.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  return { baseUrl, serviceRoleKey };
}

async function sbFetch(path, init = {}) {
  const { baseUrl, serviceRoleKey } = getEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceRoleKey);
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`,
    );
  }

  return data;
}

async function fetchSchemaColumns(tableName) {
  const openApi = await sbFetch("/rest/v1/", {
    headers: { Accept: "application/openapi+json" },
  });
  const schema =
    openApi?.components?.schemas?.[tableName] ||
    openApi?.definitions?.[tableName] ||
    openApi?.definitions?.[`public.${tableName}`];
  if (!schema || typeof schema !== "object") {
    throw new Error(`Could not load schema for table "${tableName}" from OpenAPI`);
  }
  const properties =
    schema && typeof schema.properties === "object" ? schema.properties : {};
  return new Set(Object.keys(properties));
}

function isoDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildDailyMetrics(dayIndex, totalDays, date) {
  const trend = dayIndex / Math.max(totalDays - 1, 1);
  const weekendFactor = isWeekend(date) ? 0.82 : 1;

  const shopifyRevenue = round(
    randomBetween(80, 250) * (1 + trend * 0.12) * weekendFactor,
    2,
  );
  const amazonRevenue = round(
    randomBetween(30, 120) * (1 + trend * 0.1) * (isWeekend(date) ? 0.9 : 1),
    2,
  );
  const ga4Sessions = round(
    randomBetween(100, 400) * (1 + trend * 0.15) * weekendFactor,
    0,
  );
  const ga4ConversionRate = round(randomBetween(1.0, 3.0), 3);
  const shopifyOrders = round(
    randomBetween(3, 12) * (1 + trend * 0.08) * weekendFactor,
    0,
  );
  const amazonOrders = round(
    randomBetween(2, 8) * (1 + trend * 0.08) * (isWeekend(date) ? 0.9 : 1),
    0,
  );
  const grossMarginPct = round(randomBetween(55, 65), 2);
  const cacBlended = round(randomBetween(8, 15) * (1 - trend * 0.04), 2);

  return [
    {
      metric_name: "shopify_revenue_daily",
      value: shopifyRevenue,
      department: "sales_and_growth",
      metric_group: "sales",
      source_system: "shopify",
    },
    {
      metric_name: "amazon_revenue_daily",
      value: amazonRevenue,
      department: "amazon",
      metric_group: "sales",
      source_system: "amazon",
    },
    {
      metric_name: "ga4_sessions_daily",
      value: ga4Sessions,
      department: "marketing",
      metric_group: "sales",
      source_system: "calculated",
    },
    {
      metric_name: "ga4_conversion_rate",
      value: ga4ConversionRate,
      department: "ecommerce",
      metric_group: "sales",
      source_system: "calculated",
    },
    {
      metric_name: "shopify_orders_daily",
      value: shopifyOrders,
      department: "ecommerce",
      metric_group: "sales",
      source_system: "shopify",
    },
    {
      metric_name: "amazon_orders_daily",
      value: amazonOrders,
      department: "amazon",
      metric_group: "sales",
      source_system: "amazon",
    },
    {
      metric_name: "gross_margin_pct",
      value: grossMarginPct,
      department: "finance",
      metric_group: "finance",
      source_system: "calculated",
    },
    {
      metric_name: "cac_blended",
      value: cacBlended,
      department: "marketing",
      metric_group: "sales",
      source_system: "calculated",
    },
    // Canonical metric names used by Abra dashboards and models.
    {
      metric_name: "daily_revenue_shopify",
      value: shopifyRevenue,
      department: "sales_and_growth",
      metric_group: "sales",
      source_system: "shopify",
    },
    {
      metric_name: "daily_revenue_amazon",
      value: amazonRevenue,
      department: "amazon",
      metric_group: "sales",
      source_system: "amazon",
    },
    {
      metric_name: "daily_orders_shopify",
      value: shopifyOrders,
      department: "ecommerce",
      metric_group: "sales",
      source_system: "shopify",
    },
    {
      metric_name: "daily_orders_amazon",
      value: amazonOrders,
      department: "amazon",
      metric_group: "sales",
      source_system: "amazon",
    },
    {
      metric_name: "daily_sessions",
      value: ga4Sessions,
      department: "marketing",
      metric_group: "sales",
      source_system: "calculated",
    },
    {
      metric_name: "conversion_rate",
      value: ga4ConversionRate,
      department: "ecommerce",
      metric_group: "sales",
      source_system: "calculated",
    },
  ];
}

function buildInsertRows(columns) {
  const rows = [];
  const totalDays = 30;
  const today = startOfDay(new Date());

  for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - offset);
    const dayIndex = totalDays - 1 - offset;
    const metrics = buildDailyMetrics(dayIndex, totalDays, date);

    for (const metric of metrics) {
      const row = {
        metric_name: metric.metric_name,
        value: metric.value,
      };

      if (columns.has("department")) row.department = metric.department;
      if (columns.has("metadata")) {
        row.metadata = {
          seeded_by: "seed-kpi-timeseries.mjs",
          seeded_at: new Date().toISOString(),
          note: "Synthetic data for forecasting and anomaly testing",
        };
      }
      if (columns.has("entity_ref")) row.entity_ref = "global";
      if (columns.has("metric_group")) row.metric_group = metric.metric_group;
      if (columns.has("source_system")) row.source_system = metric.source_system;
      if (columns.has("window_type")) row.window_type = "daily";
      if (columns.has("captured_for_date")) row.captured_for_date = isoDateOnly(date);
      if (columns.has("recorded_at")) row.recorded_at = date.toISOString();

      rows.push(row);
    }
  }

  return rows;
}

async function main() {
  const columns = await fetchSchemaColumns("kpi_timeseries");
  const rows = buildInsertRows(columns);
  if (rows.length === 0) {
    throw new Error("No KPI rows generated");
  }

  let path = "/rest/v1/kpi_timeseries";
  if (
    columns.has("captured_for_date") &&
    columns.has("entity_ref") &&
    columns.has("window_type")
  ) {
    path += `?on_conflict=${encodeURIComponent(
      "metric_name,entity_ref,captured_for_date,window_type",
    )}`;
  }

  await sbFetch(path, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rows),
  });

  console.log(`Seeded ${rows.length} KPI rows into kpi_timeseries.`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`seed-kpi-timeseries failed: ${message}`);
  process.exit(1);
});
