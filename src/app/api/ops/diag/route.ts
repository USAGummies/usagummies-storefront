/**
 * GET /api/ops/diag — Diagnostic endpoint for debugging data sources
 *
 * Returns status of all integrations without auth requirement.
 * TEMPORARY — remove after debugging.
 */

import { NextResponse } from "next/server";
import { isPlaidConfigured, isPlaidConnected } from "@/lib/finance/plaid";
import {
  isShopifyPaymentsConfigured,
  fetchShopifyPaymentsBalance,
} from "@/lib/finance/shopify-payments";
import {
  isAmazonConfigured,
  fetchFinancialEventGroups,
} from "@/lib/amazon/sp-api";
import { readState } from "@/lib/ops/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, unknown> = {};

  // 1. Plaid status
  results.plaid = {
    configured: isPlaidConfigured(),
    connected: false,
    error: null as string | null,
  };
  try {
    results.plaid = {
      ...results.plaid as Record<string, unknown>,
      connected: await isPlaidConnected(),
    };
  } catch (err) {
    (results.plaid as Record<string, unknown>).error = String(err);
  }

  // 2. Shopify Payments status
  results.shopifyPayments = {
    configured: isShopifyPaymentsConfigured(),
    data: null as unknown,
    error: null as string | null,
  };
  if (isShopifyPaymentsConfigured()) {
    try {
      const balance = await fetchShopifyPaymentsBalance();
      (results.shopifyPayments as Record<string, unknown>).data = balance;
    } catch (err) {
      (results.shopifyPayments as Record<string, unknown>).error = String(err);
    }
  }

  // 3. Amazon Finance status
  results.amazonFinance = {
    configured: isAmazonConfigured(),
    data: null as unknown,
    error: null as string | null,
  };
  if (isAmazonConfigured()) {
    try {
      // Try with no date filter first (returns all recent groups)
      const groupsNoFilter = await fetchFinancialEventGroups();
      // Then try with 90-day filter
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const groupsFiltered = await fetchFinancialEventGroups(ninetyDaysAgo.toISOString());
      (results.amazonFinance as Record<string, unknown>).data = {
        noFilterCount: groupsNoFilter.length,
        filteredCount: groupsFiltered.length,
        firstGroupNoFilter: groupsNoFilter[0] || null,
        firstGroupFiltered: groupsFiltered[0] || null,
      };
    } catch (err) {
      (results.amazonFinance as Record<string, unknown>).error = String(err);
    }
  }

  // 4. Cache status
  const caches = [
    "plaid-balance-cache",
    "shopify-payments-cache",
    "amazon-finance-cache",
    "pipeline-cache",
    "inbox-unified-cache",
    "pnl-cache",
  ] as const;
  results.caches = {};
  for (const key of caches) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = await readState<{ cachedAt?: number } | null>(key as any, null);
      (results.caches as Record<string, unknown>)[key] = val
        ? { exists: true, age: Math.round((Date.now() - (val.cachedAt || 0)) / 1000) + "s" }
        : { exists: false };
    } catch {
      (results.caches as Record<string, unknown>)[key] = { error: "read failed" };
    }
  }

  // 5. Notion Pipeline — property names diagnostic
  results.pipeline = { error: null as string | null, b2bProps: [] as string[], distProps: [] as string[], sampleValues: {} as Record<string, unknown> };
  try {
    const notionKey = process.env.NOTION_API_KEY || "";
    const b2bDb = process.env.NOTION_B2B_PROSPECTS_DB || "";
    if (notionKey && b2bDb) {
      const res = await fetch(`https://api.notion.com/v1/databases/${b2bDb}/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${notionKey}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
        body: JSON.stringify({ page_size: 1 }),
      });
      if (res.ok) {
        const data = await res.json();
        const page = data.results?.[0];
        if (page) {
          (results.pipeline as Record<string, unknown>).b2bProps = Object.keys(page.properties);
          // Show types + values for number/value fields
          const sample: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(page.properties as Record<string, Record<string, unknown>>)) {
            sample[key] = { type: val.type };
            if (val.type === "number") sample[key] = { type: "number", value: val.number };
            if (val.type === "select") sample[key] = { type: "select", value: (val.select as Record<string, unknown>)?.name };
          }
          (results.pipeline as Record<string, unknown>).sampleValues = sample;
        }
      }
    }
  } catch (err) {
    (results.pipeline as Record<string, unknown>).error = String(err);
  }

  // 6. Env var presence (names only, not values)
  const envChecks = [
    "PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV",
    "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_STORE_DOMAIN",
    "LWA_CLIENT_ID", "LWA_CLIENT_SECRET", "LWA_REFRESH_TOKEN",
    "SLACK_BOT_TOKEN",
    "GMAIL_APP_PASSWORD", "GMAIL_USER",
    "NOTION_API_KEY",
  ];
  results.envVars = {};
  for (const key of envChecks) {
    (results.envVars as Record<string, unknown>)[key] = !!process.env[key];
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
