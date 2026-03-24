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
// Zod v4's z.object({}) produces JSON Schema type:"None" which OpenAI rejects.
// The zod/v3 compat layer generates correct type:"object", so we use it here.
import { z as _z } from "zod/v3";
const z = _z as any;
import {
  queryDatabase,
  DB,
  extractNumber,
  extractDate,
  extractText,
} from "@/lib/notion/client";
import { readState } from "@/lib/ops/state";
import { validateRequest, ChatRequestSchema } from "@/lib/ops/validation";
import type { AmazonKPIs, CashPosition } from "@/lib/amazon/types";
import { buildAmazonKPIs } from "@/lib/amazon/kpi-builder";
import { getCachedKPIs } from "@/lib/amazon/cache";
import { isAmazonConfigured } from "@/lib/amazon/sp-api";
import { buildPnL } from "@/lib/finance/pnl";
import { buildForecastReport } from "@/lib/finance/forecast";
import {
  isPlaidConfigured,
  isPlaidConnected,
  getBalances as getPlaidBalances,
} from "@/lib/finance/plaid";
import {
  isShopifyPaymentsConfigured,
  fetchShopifyPaymentsBalance,
} from "@/lib/finance/shopify-payments";
import {
  isAmazonConfigured as isAmazonFinConfigured,
} from "@/lib/amazon/sp-api";
import type { CacheEnvelope } from "@/lib/amazon/types";

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
- Cash is tracked across Bank of America (banking via Plaid), Shopify Payments, and Amazon Settlements
- B2B pipeline is tracked in Notion with stages: Lead → Contacted → Interested → Negotiation → Proposal Sent → Closed Won/Lost
- Communications come from Email (Gmail), Slack, B2B pipeline notes, Shopify customers, Amazon buyers

BEHAVIOR:
- Be concise and data-driven. Lead with numbers.
- When asked about trends, query the Notion KPI history for multi-day data.
- When asked about "today" or "current", use the getKPIs tool.
- When asked about cash/finance/balances, use the getBalances tool for account balances or getCashPosition for local financial data.
- When asked about cash flow projections or runway, use the getForecast tool.
- When asked about profit, P&L, margins, or expenses, use the getPnL tool.
- When asked about pipeline, leads, deals, or wholesale prospects, use the getPipeline tool.
- When asked about messages, communications, or inbox, use the getInbox tool.
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
            "No cash data available. Upload a Bank of America CSV export via the Finance section to populate.",
        };
      }
      return cashPosition;
    },
  }),

  getBalances: tool({
    description:
      "Get unified cash position across all bank accounts and payment platforms. Returns balances from Bank of America (Plaid), Shopify Payments, and Amazon Settlements, plus total cash available.",
    parameters: z.object({}),
    execute: async () => {
      try {
        // Check cache first
        const cached = await readState<CacheEnvelope<Record<string, unknown>> | null>(
          "plaid-balance-cache",
          null,
        );
        if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000 && "totalCash" in (cached.data || {})) {
          return cached.data;
        }

        // Parallel fetch directly from sources (no HTTP self-call)
        const [foundResult, shopifyResult, amazonResult] = await Promise.allSettled([
          (async () => {
            if (!isPlaidConfigured()) return null;
            const connected = await isPlaidConnected();
            if (!connected) return null;
            const accounts = await getPlaidBalances();
            if (accounts.length === 0) return null;
            const balance = accounts.reduce((sum: number, a: { balances: { current: number | null } }) => sum + (a.balances.current || 0), 0);
            const available = accounts.reduce((sum: number, a: { balances: { available: number | null; current: number | null } }) => sum + (a.balances.available || a.balances.current || 0), 0);
            return { balance, available, lastUpdated: new Date().toISOString() };
          })(),
          (async () => {
            if (!isShopifyPaymentsConfigured()) return null;
            return fetchShopifyPaymentsBalance();
          })(),
          (async () => {
            if (!isAmazonFinConfigured()) return null;
            const amzCached = await readState<CacheEnvelope<{ pendingBalance: number }> | null>("amazon-finance-cache", null);
            if (amzCached && Date.now() - amzCached.cachedAt < 30 * 60 * 1000) return amzCached.data;
            return null;
          })(),
        ]);

        const found = foundResult.status === "fulfilled" ? foundResult.value : null;
        const shopify = shopifyResult.status === "fulfilled" ? shopifyResult.value : null;
        const amazon = amazonResult.status === "fulfilled" ? amazonResult.value : null;

        let totalCash = 0;
        if (found) totalCash += (found as { available: number }).available;
        if (shopify) totalCash += (shopify as { balance: number }).balance;
        if (amazon) totalCash += (amazon as { pendingBalance: number }).pendingBalance;

        return {
          found,
          shopify,
          amazon,
          totalCash: Math.round(totalCash * 100) / 100,
          lastUpdated: new Date().toISOString(),
        };
      } catch (err) {
        console.error("[chat] getBalances error:", err);
        return { error: "Balances unavailable. Check Plaid/Shopify/Amazon configuration." };
      }
    },
  }),

  getForecast: tool({
    description:
      "Get cash flow forecast projections for 30, 60, and 90 days. Includes projected daily balances, known receivables (Amazon settlements, Shopify payouts, B2B invoices), known payables (COGS, recurring expenses), runway estimation, and cash alerts.",
    parameters: z.object({
      horizon: z.string().optional().describe("Forecast horizon: '30d', '60d', or '90d'. Default is '30d'."),
    }),
    execute: async ({ horizon }: { horizon?: string }) => {
      try {
        const data = await buildForecastReport();
        const h = horizon || "30d";
        const validH = (["30d", "60d", "90d"].includes(h) ? h : "30d") as "30d" | "60d" | "90d";
        return {
          currentBalance: data.currentBalance,
          runway: data.runway,
          alerts: data.alerts,
          projection: data.projections?.[validH]?.slice(0, 14) || [],
          projectionDays: data.projections?.[validH]?.length || 0,
          summary: {
            startBalance: data.projections?.[validH]?.[0]?.openingBalance,
            endBalance: data.projections?.[validH]?.slice(-1)?.[0]?.closingBalance,
            totalInflows: data.projections?.[validH]?.reduce((s: number, d: { inflows: number }) => s + d.inflows, 0),
            totalOutflows: data.projections?.[validH]?.reduce((s: number, d: { outflows: number }) => s + d.outflows, 0),
          },
        };
      } catch (err) {
        console.error("[chat] getForecast error:", err);
        return { error: "Forecast unavailable." };
      }
    },
  }),

  getPnL: tool({
    description:
      "Get the Profit & Loss report. Returns revenue breakdown (Amazon, Shopify, Wholesale), COGS, gross profit, gross margin, operating expenses, net income, and net margin. Defaults to month-to-date.",
    parameters: z.object({
      period: z.string().optional().describe("Period: 'mtd' (month-to-date, default) or 'custom'"),
      start: z.string().optional().describe("Start date YYYY-MM-DD (for custom period)"),
      end: z.string().optional().describe("End date YYYY-MM-DD (for custom period)"),
    }),
    execute: async ({ period, start, end }: { period?: string; start?: string; end?: string }) => {
      try {
        const startDate = period === "custom" ? start : undefined;
        const endDate = period === "custom" ? end : undefined;
        return await buildPnL(startDate, endDate);
      } catch (err) {
        console.error("[chat] getPnL error:", err);
        return { error: "Failed to build P&L report." };
      }
    },
  }),

  getPipeline: tool({
    description:
      "Get B2B and distributor sales pipeline data. Returns total leads, pipeline value, stage breakdown with deal counts and values, conversion rates between stages, pipeline velocity (avg days to close), recent activity, and weekly trends.",
    parameters: z.object({}),
    execute: async () => {
      try {
        // Read from pipeline cache (populated by /api/ops/pipeline route)
        const cached = await readState<CacheEnvelope<Record<string, unknown>> | null>(
          "pipeline-cache",
          null,
        );
        if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) {
          const data = cached.data;
          return {
            totalLeads: data.totalLeads,
            b2bCount: data.b2bCount,
            distributorCount: data.distributorCount,
            stageCounts: data.stageCounts,
            pipelineValue: data.pipelineValue,
            velocity: data.velocity,
            conversionRates: data.conversionRates,
            recentActivity: (data.recentActivity as unknown[])?.slice(0, 10),
            weeklyTrend: data.weeklyTrend,
            generatedAt: data.generatedAt,
          };
        }

        // No cache — query Notion B2B prospect databases directly
        const B2B_DB = process.env.NOTION_B2B_PROSPECTS_DB || "";
        const DIST_DB = process.env.NOTION_DISTRIBUTOR_PROSPECTS_DB || "";
        if (!B2B_DB && !DIST_DB) {
          return { error: "No pipeline databases configured. Set NOTION_B2B_PROSPECTS_DB in env vars." };
        }

        const [b2bPages, distPages] = await Promise.all([
          B2B_DB ? queryDatabase(B2B_DB as unknown as Parameters<typeof queryDatabase>[0]) : Promise.resolve([]),
          DIST_DB ? queryDatabase(DIST_DB as unknown as Parameters<typeof queryDatabase>[0]) : Promise.resolve([]),
        ]);

        const totalLeads = (b2bPages?.length || 0) + (distPages?.length || 0);
        const stageCounts: Record<string, number> = {};
        for (const page of [...(b2bPages || []), ...(distPages || [])]) {
          const props = (page.properties || {}) as Record<string, unknown>;
          const status = extractText(props.Status || props.Stage || props["Pipeline Stage"]) || "Unknown";
          stageCounts[status] = (stageCounts[status] || 0) + 1;
        }

        return {
          totalLeads,
          b2bCount: b2bPages?.length || 0,
          distributorCount: distPages?.length || 0,
          stageCounts,
          pipelineValue: { total: 0, byStage: {} },
          note: "Showing live data — visit Pipeline tab to populate full cache with velocity & conversion data.",
        };
      } catch (err) {
        console.error("[chat] getPipeline error:", err);
        return { error: "Pipeline unavailable. Check Notion configuration." };
      }
    },
  }),

  getInbox: tool({
    description:
      "Get unified communications inbox across all channels. Returns recent messages from Email (Gmail), Slack, B2B pipeline, Shopify customers, and Amazon buyers, with unread counts per source.",
    parameters: z.object({
      source: z.string().optional().describe("Filter by source: 'all' (default), 'email', 'slack', 'b2b', 'shopify', 'amazon'"),
      unread: z.string().optional().describe("Set to 'true' to show only unread messages"),
    }),
    execute: async () => {
      try {
        // Read from inbox cache (populated by /api/ops/inbox route)
        const cached = await readState<CacheEnvelope<Record<string, unknown>> | null>(
          "inbox-unified-cache",
          null,
        );
        if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) {
          return cached.data;
        }

        // No cache — try fetching directly from sources
        const messages: Record<string, unknown>[] = [];

        // Gmail
        try {
          const { listEmails } = await import("@/lib/ops/gmail-reader");
          const emails = await listEmails({ count: 10, unreadOnly: false });
          for (const e of emails) {
            messages.push({
              id: `email-${e.id}`,
              source: "email",
              from: e.from,
              subject: e.subject,
              snippet: e.snippet,
              date: new Date(e.date).toISOString(),
              read: !e.labelIds.includes("UNREAD"),
            });
          }
        } catch { /* Gmail not configured */ }

        // B2B Pipeline comms from Notion
        try {
          const { fetchB2BPipelineComms } = await import("@/lib/comms/b2b-comms");
          const b2b = await fetchB2BPipelineComms(10);
          messages.push(...b2b.map((m) => ({ ...m })));
        } catch { /* B2B comms not configured */ }

        const unreadCount = messages.filter((m) => !m.read).length;

        return {
          messages: messages.slice(0, 20),
          totalCount: messages.length,
          unreadCount,
          lastUpdated: new Date().toISOString(),
          note: messages.length === 0
            ? "No messages found. Configure Gmail (GMAIL_APP_PASSWORD), Slack (SLACK_BOT_TOKEN), or check Notion B2B database."
            : undefined,
        };
      } catch (err) {
        console.error("[chat] getInbox error:", err);
        return { error: "Inbox unavailable." };
      }
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
    const v = await validateRequest(req, ChatRequestSchema);
    if (!v.success) return v.response;
    const { messages } = v.data;

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
      JSON.stringify({ error: "Chat request failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
