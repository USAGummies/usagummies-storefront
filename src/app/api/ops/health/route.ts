/**
 * GET /api/ops/health — Comprehensive integration health check
 *
 * Checks all critical external services in parallel with 5s timeouts.
 * Returns overall status: healthy / degraded / unhealthy.
 *
 * Auth: Requires HEALTH_CHECK_SECRET header or returns summary-only (no details).
 * Phase 6A — Enterprise Hardening.
 */

import { NextRequest, NextResponse } from "next/server";
import { getNotionApiKey, getNotionCredential } from "@/lib/notion/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckStatus = "ok" | "error" | "timeout";

type CheckResult = {
  status: CheckStatus;
  latency_ms: number;
  error?: string;
};

type HealthResponse = {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime_s: number;
  checks: Record<string, CheckResult>;
  version: string;
};

// ---------------------------------------------------------------------------
// Boot time (approximates deploy time for uptime calc)
// ---------------------------------------------------------------------------

const BOOT_TIME = Date.now();

// ---------------------------------------------------------------------------
// Timeout wrapper — races a promise against a 5s deadline
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  label: string,
  fn: () => Promise<T>,
  timeoutMs = 5000,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs),
      ),
    ]);
    return { status: "ok", latency_ms: Date.now() - start };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    const isTimeout = message === "TIMEOUT";
    return {
      status: isTimeout ? "timeout" : "error",
      latency_ms: Date.now() - start,
      error: message.slice(0, 200),
    };
  }
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/** Shopify Storefront API — lightweight products query */
async function checkShopifyStorefront(): Promise<void> {
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;
  const token =
    process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN;

  if (!domain || !token) throw new Error("Missing storefront credentials");

  const version =
    process.env.SHOPIFY_STOREFRONT_API_VERSION || "2024-07";
  const endpoint = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/api/${version}/graphql.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({
      query: `{ shop { name } }`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "GraphQL error");
  }
}

/** Shopify Admin API — lightweight shop query */
async function checkShopifyAdmin(): Promise<void> {
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    "usa-gummies.myshopify.com";
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!token) throw new Error("SHOPIFY_ADMIN_TOKEN not configured");

  const clean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const endpoint = `https://${clean}/admin/api/2024-10/graphql.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `{ shop { name } }`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "GraphQL error");
  }
}

/** Notion API — query a known database (page_size=1 for speed) */
async function checkNotion(): Promise<void> {
  const apiKey = getNotionApiKey();
  if (!apiKey) throw new Error("NOTION_API_KEY not configured");

  const dbId =
    getNotionCredential("NOTION_DAILY_PERF_DB_ID") ||
    "2f31cfad04b744e3b16da4edc9675502";

  const res = await fetch(
    `https://api.notion.com/v1/databases/${dbId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
  }
}

/** Supabase — simple REST health check via PostgREST */
async function checkSupabase(): Promise<void> {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl) throw new Error("SUPABASE_URL not configured");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");

  // Query the product_config table with limit 1 — lightweight existence check
  const res = await fetch(
    `${baseUrl}/rest/v1/product_config?select=id&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
  }
}

/** Upstash Redis / Vercel KV — ping via REST API */
async function checkRedis(): Promise<void> {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) throw new Error("KV_REST_API_URL/TOKEN not configured");

  // Upstash REST API: POST with ["PING"] command
  const res = await fetch(`${kvUrl}/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["PING"]),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
  }

  const json = await res.json();
  if (json.error) throw new Error(json.error);
}

// ---------------------------------------------------------------------------
// Auth check
// ---------------------------------------------------------------------------

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.HEALTH_CHECK_SECRET;
  if (!secret) return false; // No secret configured = no detailed access

  const header = req.headers.get("x-health-secret") || "";
  if (header === secret) return true;

  // Also accept Bearer token
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const authorized = isAuthorized(req);

  // Run all checks in parallel
  const [
    shopifyStorefront,
    shopifyAdmin,
    notion,
    supabase,
    redis,
  ] = await Promise.allSettled([
    withTimeout("shopify_storefront", checkShopifyStorefront),
    withTimeout("shopify_admin", checkShopifyAdmin),
    withTimeout("notion", checkNotion),
    withTimeout("supabase", checkSupabase),
    withTimeout("redis", checkRedis),
  ]);

  const checks: Record<string, CheckResult> = {
    shopify_storefront:
      shopifyStorefront.status === "fulfilled"
        ? shopifyStorefront.value
        : { status: "error", latency_ms: 0, error: "check crashed" },
    shopify_admin:
      shopifyAdmin.status === "fulfilled"
        ? shopifyAdmin.value
        : { status: "error", latency_ms: 0, error: "check crashed" },
    notion:
      notion.status === "fulfilled"
        ? notion.value
        : { status: "error", latency_ms: 0, error: "check crashed" },
    supabase:
      supabase.status === "fulfilled"
        ? supabase.value
        : { status: "error", latency_ms: 0, error: "check crashed" },
    redis:
      redis.status === "fulfilled"
        ? redis.value
        : { status: "error", latency_ms: 0, error: "check crashed" },
  };

  // Determine overall status
  const allChecks = Object.values(checks);
  const okCount = allChecks.filter((c) => c.status === "ok").length;
  const totalCount = allChecks.length;

  // Critical services: shopify_storefront and supabase
  const criticalDown =
    checks.shopify_storefront.status !== "ok" ||
    checks.supabase.status !== "ok";

  let status: "healthy" | "degraded" | "unhealthy";
  if (okCount === totalCount) {
    status = "healthy";
  } else if (criticalDown && okCount < totalCount / 2) {
    status = "unhealthy";
  } else if (criticalDown) {
    status = "degraded";
  } else {
    status = "degraded";
  }

  const body: HealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    uptime_s: Math.round((Date.now() - BOOT_TIME) / 1000),
    checks: authorized
      ? checks
      : // Strip error details for unauthenticated requests
        Object.fromEntries(
          Object.entries(checks).map(([key, val]) => [
            key,
            { status: val.status, latency_ms: val.latency_ms },
          ]),
        ),
    version: "0.1.0",
  };

  const httpStatus = status === "healthy" ? 200 : status === "degraded" ? 200 : 503;

  return NextResponse.json(body, {
    status: httpStatus,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
