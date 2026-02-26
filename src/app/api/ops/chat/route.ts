/**
 * POST /api/ops/chat — Streaming AI chat with tool-calling for the ops dashboard.
 *
 * Uses Vercel AI SDK v4 with OpenAI gpt-4o-mini. The AI can query live business
 * data, Notion KPI history, inventory status, agent health, and cash position.
 *
 * Protected by middleware (requires JWT session).
 */

import { streamText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  queryDatabase,
  DB,
  extractNumber,
  extractDate,
  extractText,
} from "@/lib/notion/client";
import { readState } from "@/lib/ops/state";
import type { AmazonKPIs, CashPosition } from "@/lib/amazon/types";
import { buildAmazonKPIs } from "@/lib/amazon/kpi-builder";
import { getCachedKPIs } from "@/lib/amazon/cache";
import { isAmazonConfigured } from "@/lib/amazon/sp-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const OPS_SYSTEM_PROMPT = `You are the USA Gummies operations AI assistant embedded in the ops dashboard.
You have access to real-time business data through tools. Use them to answer questions accurately.

ABOUT THE BUSINESS:
- USA Gummies sells gummy vitamins/supplements via Shopify DTC and Amazon FBA
- Single product line, multiple SKUs (variety packs, bundles)
- Amazon Seller ID: A16G27VYDSSEGO (US marketplace)
- Shopify store: usagummies.com
- The business also does B2B/wholesale via Faire and direct outreach
- 80 automated agents run across 6 engines (B2B, SEO, DTC, Supply Chain, Revenue Intel, FinOps)

CONTEXT:
- All revenue figures are in USD
- "MTD" = month to date, "WTD" = week to date
- Amazon fees include referral fee (~15%) and FBA fulfillment fee
- FBA inventory "days of supply" = fulfillable units / (7-day avg units sold per day)
- Daily Performance Reports DB in Notion has historical daily snapshots

BEHAVIOR:
- Be concise and data-driven. Lead with numbers.
- When asked about trends, query the Notion KPI history for multi-day data.
- When asked about "today" or "current", use the getKPIs tool.
- When asked about cash/finance, use the getCashPosition tool.
- Format currency as $X,XXX.XX. Format percentages with 1 decimal.
- If a tool returns no data, say so clearly — don't guess.
- You can compare time periods by querying the KPI history with different date ranges.
- Keep responses under 300 words unless the user asks for detail.`;

// ---------------------------------------------------------------------------
// Shopify fetcher (inline — avoids circular HTTP call to dashboard route)
// ---------------------------------------------------------------------------

async function fetchShopifySummary() {
  const token = process.env.SHOPIFY_ADMIN_TOKEN || "";
  const domain = (
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    ""
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  if (!token || !domain) return null;

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateFilter = `created_at:>=${thirtyDaysAgo.toISOString().split("T")[0]}`;

    const res = await fetch(
      `https://${domain}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: `query($q:String!){orders(first:250,query:$q){edges{node{totalPriceSet{shopMoney{amount}}}}}}`,
          variables: { q: dateFilter },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!res.ok) return null;
    const json = await res.json();
    const edges = json.data?.orders?.edges || [];
    const totalRevenue = edges.reduce(
      (sum: number, e: { node: { totalPriceSet: { shopMoney: { amount: string } } } }) =>
        sum + parseFloat(e.node.totalPriceSet?.shopMoney?.amount || "0"),
      0,
    );
    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOrders: edges.length,
      avgOrderValue:
        edges.length > 0
          ? Math.round((totalRevenue / edges.length) * 100) / 100
          : 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const tools = {
  getKPIs: tool({
    description:
      "Get current real-time KPIs from Shopify and Amazon. Returns today's revenue, orders, AOV, inventory, fees, velocity, and comparison metrics.",
    parameters: z.object({}),
    execute: async () => {
      const [shopify, amazonKPIs] = await Promise.all([
        fetchShopifySummary(),
        (async () => {
          if (!isAmazonConfigured()) return null;
          const cached = await getCachedKPIs<AmazonKPIs>();
          if (cached) return cached;
          return buildAmazonKPIs().catch(() => null);
        })(),
      ]);

      return {
        shopify,
        amazon: amazonKPIs
          ? {
              revenueToday: amazonKPIs.revenue.today,
              revenueYesterday: amazonKPIs.revenue.yesterday,
              revenueMTD: amazonKPIs.revenue.monthToDate,
              ordersToday: amazonKPIs.orders.today,
              ordersMTD: amazonKPIs.orders.monthToDate,
              unitsSoldToday: amazonKPIs.unitsSold.today,
              inventory: amazonKPIs.inventory,
              fees: amazonKPIs.fees,
              velocity: amazonKPIs.velocity,
              comparison: amazonKPIs.comparison,
            }
          : null,
        generatedAt: new Date().toISOString(),
      };
    },
  }),

  queryKPIHistory: tool({
    description:
      "Query historical daily KPI snapshots from Notion. Returns daily revenue, orders, AOV for a date range. Use this for trend analysis, week-over-week comparisons, or questions about past performance.",
    parameters: z.object({
      startDate: z.string().describe("Start date in YYYY-MM-DD format"),
      endDate: z.string().describe("End date in YYYY-MM-DD format"),
    }),
    execute: async ({ startDate, endDate }: { startDate: string; endDate: string }) => {
      const results = await queryDatabase(
        DB.DAILY_PERFORMANCE,
        {
          and: [
            { property: "Date", date: { on_or_after: startDate } },
            { property: "Date", date: { on_or_before: endDate } },
          ],
        },
        [{ property: "Date", direction: "ascending" }],
      );

      if (!results || results.length === 0) {
        return {
          days: [] as Record<string, unknown>[],
          message:
            "No historical data found for this date range. KPI snapshots may not have been recorded yet.",
        };
      }

      const days = results.map((page) => {
        const p = (page.properties || {}) as Record<string, unknown>;
        return {
          date: extractDate(p["Date"]) || extractText(p["Name"]),
          shopifyRevenue: extractNumber(p["Shopify Revenue"]),
          amazonRevenue: extractNumber(p["Amazon Revenue"]),
          totalRevenue: extractNumber(p["Total Revenue"]),
          shopifyOrders: extractNumber(p["Shopify Orders"]),
          amazonOrders: extractNumber(p["Amazon Orders"]),
          totalOrders: extractNumber(p["Total Orders"]),
          aov: extractNumber(p["AOV"]),
          amazonUnitsSold: extractNumber(p["Amazon Units Sold"]),
          fbaFulfillable: extractNumber(p["FBA Fulfillable Units"]),
        };
      });

      return { days, count: days.length };
    },
  }),

  getInventoryStatus: tool({
    description:
      "Get current FBA inventory status including fulfillable quantity, days of supply, inbound shipments, and restock alerts.",
    parameters: z.object({}),
    execute: async () => {
      if (!isAmazonConfigured())
        return { error: "Amazon SP-API not configured" };
      const cached = await getCachedKPIs<AmazonKPIs>();
      if (cached) return cached.inventory;
      const kpis = await buildAmazonKPIs().catch(() => null);
      return kpis?.inventory || { error: "Failed to fetch inventory" };
    },
  }),

  getAgentStatus: tool({
    description:
      "Get the health status of the automated agent fleet. Returns engine summaries, agent counts, success rates, and recent run history.",
    parameters: z.object({}),
    execute: async () => {
      const [systemStatus, recentRuns] = await Promise.all([
        readState("system-status", {} as Record<string, unknown>),
        readState("run-ledger-recent", [] as Record<string, unknown>[]),
      ]);

      const agents = (systemStatus as Record<string, unknown>)?.agents || {};
      const healthCounts = {
        healthy: 0,
        warning: 0,
        critical: 0,
        unknown: 0,
      };
      for (const a of Object.values(agents) as Record<string, unknown>[]) {
        if (a.lastStatus === "success") healthCounts.healthy++;
        else if (a.lastStatus === "failed") healthCounts.critical++;
        else if (a.lastStatus === "running") healthCounts.warning++;
        else healthCounts.unknown++;
      }

      return {
        healthCounts,
        recentRuns: (recentRuns as Record<string, unknown>[])
          .slice(-10)
          .reverse(),
      };
    },
  }),

  getCashPosition: tool({
    description:
      "Get the current cash position and recent transactions from the financial tracking system. Shows balance, monthly income, expenses, and net cash flow.",
    parameters: z.object({}),
    execute: async () => {
      const cashPosition = await readState<CashPosition | null>(
        "cash-position",
        null,
      );
      if (!cashPosition) {
        return {
          message:
            "No cash data available. Upload a Found.com CSV export via the Finance section to populate.",
        };
      }
      return cashPosition;
    },
  }),
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const { messages } = await req.json();

    const result = streamText({
      model: openai("gpt-4o-mini"),
      system: OPS_SYSTEM_PROMPT,
      messages,
      tools,
      maxSteps: 5,
      temperature: 0.3,
      onError: ({ error }) => {
        console.error("[ops-chat] Stream error:", error);
      },
    });

    return result.toDataStreamResponse({
      getErrorMessage: (error) => {
        console.error("[ops-chat] Data stream error:", error);
        if (error instanceof Error) return error.message;
        return "Something went wrong. Please try again.";
      },
    });
  } catch (err) {
    console.error("[ops-chat] Route error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
