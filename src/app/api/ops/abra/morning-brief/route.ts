import { NextResponse } from "next/server";
import { isAuthorized, isCronAuthorized } from "@/lib/ops/abra-auth";
import {
  generateMorningBrief,
  generateMorningBriefPayload,
} from "@/lib/ops/abra-morning-brief";
import { notify } from "@/lib/ops/notify";
import { adminRequest } from "@/lib/shopify/admin";
import {
  isAmazonConfigured,
  fetchAmazonOrderStats,
} from "@/lib/amazon/sp-api";
import { getRecentErrors } from "@/lib/ops/error-tracker";
import {
  ENGINE_REGISTRY,
  parseSchedule,
} from "@/lib/ops/engine-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Supabase helpers (matches codebase convention — raw fetch, no SDK)
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(12_000),
  });

  if (!res.ok) return null;
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Data gatherers
// ---------------------------------------------------------------------------

type ShopifyRevenueResult = {
  revenue: number;
  orderCount: number;
  error: string | null;
};

async function fetchShopifyYesterdayRevenue(): Promise<ShopifyRevenueResult> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfYesterday = new Date(yesterday);
  startOfYesterday.setHours(0, 0, 0, 0);
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);

  const query = /* GraphQL */ `
    query YesterdayOrders($query: String!) {
      orders(first: 250, query: $query) {
        edges {
          node {
            id
            totalPriceSet {
              shopMoney {
                amount
              }
            }
          }
        }
      }
    }
  `;

  const dateStr = startOfYesterday.toISOString().split("T")[0];
  const result = await adminRequest<{
    orders: {
      edges: Array<{
        node: {
          id: string;
          totalPriceSet: { shopMoney: { amount: string } };
        };
      }>;
    };
  }>(query, {
    query: `created_at:>='${dateStr}T00:00:00Z' AND created_at:<='${dateStr}T23:59:59Z'`,
  });

  if (!result.ok || !result.data) {
    return { revenue: 0, orderCount: 0, error: result.error || "Shopify query failed" };
  }

  const edges = result.data.orders?.edges || [];
  const revenue = edges.reduce(
    (sum, edge) =>
      sum + parseFloat(edge.node.totalPriceSet?.shopMoney?.amount || "0"),
    0,
  );

  return {
    revenue: Math.round(revenue * 100) / 100,
    orderCount: edges.length,
    error: null,
  };
}

type AmazonRevenueResult = {
  revenue: number;
  orderCount: number;
  configured: boolean;
  error: string | null;
};

async function fetchAmazonYesterdayRevenue(): Promise<AmazonRevenueResult> {
  if (!isAmazonConfigured()) {
    return { revenue: 0, orderCount: 0, configured: false, error: null };
  }

  try {
    const stats = await fetchAmazonOrderStats(1);
    return {
      revenue: stats.totalRevenue,
      orderCount: stats.totalOrders,
      configured: true,
      error: null,
    };
  } catch (err) {
    return {
      revenue: 0,
      orderCount: 0,
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchPendingApprovals(): Promise<number> {
  const rows = await sbFetch<Array<{ id: string }>>(
    "/rest/v1/approvals?status=eq.pending&select=id&limit=200",
  );
  return Array.isArray(rows) ? rows.length : 0;
}

async function fetchPipelineMovement(): Promise<number> {
  const notionKey = process.env.NOTION_API_KEY;
  const b2bDb = process.env.NOTION_B2B_PROSPECTS_DB;
  if (!notionKey || !b2bDb) return 0;

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${b2bDb.replace(/-/g, "")}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          filter: {
            timestamp: "last_edited_time",
            last_edited_time: { after: yesterday },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { results?: unknown[] };
    return Array.isArray(data.results) ? data.results.length : 0;
  } catch {
    return 0;
  }
}

type ErrorSummary = {
  total: number;
  critical: number;
  items: Array<{ message: string; severity: string; source: string }>;
};

async function fetchErrorSummary(): Promise<ErrorSummary> {
  try {
    const errors = await getRecentErrors(5);
    // Filter to last 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = errors.filter((e) => e.last_seen_at >= cutoff);
    return {
      total: recent.length,
      critical: recent.filter((e) => e.severity === "critical").length,
      items: recent.map((e) => ({
        message: e.message.slice(0, 100),
        severity: e.severity,
        source: e.source,
      })),
    };
  } catch {
    return { total: 0, critical: 0, items: [] };
  }
}

type SystemHealthStatus = "operational" | "degraded" | "issues";

async function checkSystemHealth(): Promise<{
  status: SystemHealthStatus;
  details: string[];
}> {
  const details: string[] = [];
  let hasIssue = false;
  let hasDegraded = false;

  // Check Supabase connectivity
  const supabaseOk = await sbFetch<unknown>(
    "/rest/v1/?limit=0",
    { method: "HEAD" },
  );
  if (supabaseOk === null && getSupabaseEnv()) {
    details.push("Supabase: unreachable");
    hasIssue = true;
  }

  // Check Shopify Admin API
  const shopifyToken = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shopifyToken) {
    details.push("Shopify Admin: not configured");
    hasDegraded = true;
  }

  // Check Amazon config
  if (!isAmazonConfigured()) {
    details.push("Amazon SP-API: not configured");
    hasDegraded = true;
  }

  // Check Slack
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const slackWebhook = process.env.SLACK_SUPPORT_WEBHOOK_URL;
  if (!slackToken && !slackWebhook) {
    details.push("Slack: no bot token or webhook");
    hasDegraded = true;
  }

  if (details.length === 0) {
    details.push("All integrations connected");
  }

  const status: SystemHealthStatus = hasIssue
    ? "issues"
    : hasDegraded
      ? "degraded"
      : "operational";

  return { status, details };
}

type ScheduledAgentsSummary = {
  count: number;
  engineNames: string[];
};

function getTodaysScheduledAgents(): ScheduledAgentsSummary {
  const now = new Date();
  // Get day of week for weekly checks
  const dayOfWeek = now.getDay(); // 0=Sun
  const dateOfMonth = now.getDate();
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayName = dayNames[dayOfWeek];

  let count = 0;
  const engineSet = new Set<string>();

  for (const engine of ENGINE_REGISTRY) {
    for (const agent of engine.agents) {
      if (agent.isSequence) continue;

      const parsed = parseSchedule(agent.schedule);

      let runsToday = false;
      if (parsed.type === "daily") {
        runsToday = true;
      } else if (parsed.type === "interval") {
        runsToday = true;
      } else if (parsed.type === "weekly") {
        const targetDay = parsed.day.toLowerCase();
        runsToday = targetDay === todayName || targetDay === dayNames[dayOfWeek];
      } else if (parsed.type === "monthly") {
        runsToday = parsed.dayOfMonth === dateOfMonth;
      }

      if (runsToday) {
        count++;
        engineSet.add(engine.name.replace(" Engine", ""));
      }
    }
  }

  return { count, engineNames: Array.from(engineSet) };
}

// ---------------------------------------------------------------------------
// Slack Block Kit formatter
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

type BriefData = {
  shopify: ShopifyRevenueResult;
  amazon: AmazonRevenueResult;
  approvals: number;
  pipelineMoves: number;
  errors: ErrorSummary;
  health: { status: SystemHealthStatus; details: string[] };
  agents: ScheduledAgentsSummary;
};

function buildSlackBlocks(data: BriefData): { text: string; blocks: unknown[] } {
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const combinedRevenue = data.shopify.revenue + data.amazon.revenue;
  const combinedOrders = data.shopify.orderCount + data.amazon.orderCount;

  // Health icon
  const healthIcon =
    data.health.status === "operational"
      ? ":white_check_mark:"
      : data.health.status === "degraded"
        ? ":warning:"
        : ":red_circle:";
  const healthLabel =
    data.health.status === "operational"
      ? "All systems operational"
      : data.health.status === "degraded"
        ? "Degraded"
        : "Issues detected";

  // Revenue section
  const revenueLines = [
    `*Shopify DTC:* ${formatCurrency(data.shopify.revenue)} (${data.shopify.orderCount} orders)${data.shopify.error ? " :warning:" : ""}`,
    data.amazon.configured
      ? `*Amazon:* ${formatCurrency(data.amazon.revenue)} (${data.amazon.orderCount} orders)${data.amazon.error ? " :warning:" : ""}`
      : "*Amazon:* Not configured",
    `*Combined:* ${formatCurrency(combinedRevenue)} (${combinedOrders} orders)`,
  ];

  // Action items section
  const actionLines: string[] = [];
  if (data.approvals > 0) {
    actionLines.push(
      `${data.approvals} pending approval${data.approvals !== 1 ? "s" : ""} awaiting your review`,
    );
  }
  if (data.pipelineMoves > 0) {
    actionLines.push(
      `${data.pipelineMoves} pipeline lead${data.pipelineMoves !== 1 ? "s" : ""} moved stages yesterday`,
    );
  }
  if (data.errors.total > 0) {
    actionLines.push(
      `${data.errors.total} unresolved error${data.errors.total !== 1 ? "s" : ""}${data.errors.critical > 0 ? ` (${data.errors.critical} critical)` : ""}`,
    );
  }
  if (actionLines.length === 0) {
    actionLines.push("No urgent items — clear runway today");
  }

  // Agent summary
  const agentEngineList =
    data.agents.engineNames.length > 0
      ? data.agents.engineNames.join(", ")
      : "none";

  // Build plaintext fallback
  const plainText = [
    `Morning Brief — ${dateLabel}`,
    `Revenue: ${formatCurrency(combinedRevenue)} (${combinedOrders} orders)`,
    `Approvals: ${data.approvals} | Errors: ${data.errors.total} | Agents: ${data.agents.count}`,
    `Health: ${healthLabel}`,
  ].join(" | ");

  // Build Block Kit blocks
  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Morning Brief — ${dateLabel}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:moneybag: *Yesterday's Revenue*\n${revenueLines.map((l) => `• ${l}`).join("\n")}`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:clipboard: *Action Items*\n${actionLines.map((l) => `• ${l}`).join("\n")}`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `:hospital: *System Health*\n${healthIcon} ${healthLabel}`,
        },
        {
          type: "mrkdwn",
          text: `:calendar: *Today's Agents*\n${data.agents.count} scheduled (${agentEngineList})`,
        },
      ],
    },
  ];

  // Add health details if not fully operational
  if (data.health.status !== "operational") {
    blocks.push({
      type: "context",
      elements: data.health.details.map((d) => ({
        type: "mrkdwn",
        text: `:small_orange_diamond: ${d}`,
      })),
    });
  }

  // Add error detail context if critical errors exist
  if (data.errors.critical > 0) {
    const criticalItems = data.errors.items
      .filter((e) => e.severity === "critical")
      .slice(0, 3);
    if (criticalItems.length > 0) {
      blocks.push({
        type: "context",
        elements: criticalItems.map((e) => ({
          type: "mrkdwn",
          text: `:red_circle: [${e.source}] ${e.message}`,
        })),
      });
    }
  }

  return { text: plainText, blocks };
}

// ---------------------------------------------------------------------------
// Supabase storage
// ---------------------------------------------------------------------------

async function storeBriefInSupabase(
  data: BriefData,
  slackText: string,
): Promise<void> {
  const env = getSupabaseEnv();
  if (!env) return;

  const payload = {
    generated_at: new Date().toISOString(),
    shopify_revenue: data.shopify.revenue,
    shopify_orders: data.shopify.orderCount,
    amazon_revenue: data.amazon.revenue,
    amazon_orders: data.amazon.orderCount,
    combined_revenue: data.shopify.revenue + data.amazon.revenue,
    combined_orders: data.shopify.orderCount + data.amazon.orderCount,
    pending_approvals: data.approvals,
    pipeline_moves: data.pipelineMoves,
    unresolved_errors: data.errors.total,
    critical_errors: data.errors.critical,
    system_health: data.health.status,
    scheduled_agents: data.agents.count,
    slack_text: slackText.slice(0, 4000),
    raw_data: data,
  };

  await sbFetch("/rest/v1/abra_morning_briefs", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// GET handler (unchanged — serves dashboard previews)
// ---------------------------------------------------------------------------

const BRIEF_CACHE_TTL_MS = 2 * 60 * 1000;

let payloadCache:
  | {
      payload: Awaited<ReturnType<typeof generateMorningBriefPayload>>;
      expiresAt: number;
    }
  | null = null;

function buildPreviewBrief(
  payload: Awaited<ReturnType<typeof generateMorningBriefPayload>>,
): string {
  const revenueTotal = Number(payload.revenue.total_current || 0);
  const sessions = Number(payload.traffic.sessions?.current || 0);
  const openActions = Number(payload.open_action_items.total_open || 0);
  const anomalies = Number(payload.anomalies.count || 0);
  const signals = Number(payload.signals.count || 0);

  return [
    "Morning Brief (Preview)",
    `Revenue total: $${revenueTotal.toFixed(2)}`,
    `Sessions: ${Math.round(sessions)}`,
    `Open actions: ${openActions}`,
    `Anomalies: ${anomalies}, Signals: ${signals}`,
  ].join("\n");
}

async function getCachedPayload(forceRefresh: boolean) {
  if (!forceRefresh && payloadCache && Date.now() < payloadCache.expiresAt) {
    return payloadCache.payload;
  }

  const payload = await generateMorningBriefPayload();
  payloadCache = {
    payload,
    expiresAt: Date.now() + BRIEF_CACHE_TTL_MS,
  };
  return payload;
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const mode = (url.searchParams.get("mode") || "quick").toLowerCase();
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const isFullMode = mode === "full";

    const payload = await getCachedPayload(forceRefresh);
    const briefText = isFullMode
      ? await generateMorningBrief()
      : buildPreviewBrief(payload);

    return NextResponse.json({
      ok: true,
      route: "morning-brief",
      mode: isFullMode ? "full" : "quick",
      payload,
      brief: briefText,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate morning brief preview",
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST handler — full Morning Brief with parallel data gathering, Block Kit,
// Slack delivery, and Supabase archival
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Gather all data sources in parallel
    const [
      shopifyResult,
      amazonResult,
      approvalsResult,
      pipelineResult,
      errorsResult,
      healthResult,
    ] = await Promise.all([
      fetchShopifyYesterdayRevenue().catch(
        (): ShopifyRevenueResult => ({
          revenue: 0,
          orderCount: 0,
          error: "Shopify fetch failed",
        }),
      ),
      fetchAmazonYesterdayRevenue().catch(
        (): AmazonRevenueResult => ({
          revenue: 0,
          orderCount: 0,
          configured: isAmazonConfigured(),
          error: "Amazon fetch failed",
        }),
      ),
      fetchPendingApprovals().catch(() => 0),
      fetchPipelineMovement().catch(() => 0),
      fetchErrorSummary().catch(
        (): ErrorSummary => ({ total: 0, critical: 0, items: [] }),
      ),
      checkSystemHealth().catch(() => ({
        status: "degraded" as SystemHealthStatus,
        details: ["Health check failed"],
      })),
    ]);

    // Agent schedule is synchronous — no need to await
    const agentsResult = getTodaysScheduledAgents();

    const briefData: BriefData = {
      shopify: shopifyResult,
      amazon: amazonResult,
      approvals: approvalsResult,
      pipelineMoves: pipelineResult,
      errors: errorsResult,
      health: healthResult,
      agents: agentsResult,
    };

    // 2. Format as Slack Block Kit message
    const { text, blocks } = buildSlackBlocks(briefData);

    // 3. Post to Slack via notify (channel: "daily")
    const slackResult = await notify({
      channel: "daily",
      text,
      blocks,
    });

    // 4. Store in Supabase for history (best-effort)
    await storeBriefInSupabase(briefData, text).catch((err) => {
      console.error(
        "[morning-brief] Supabase storage failed:",
        err instanceof Error ? err.message : err,
      );
    });

    return NextResponse.json({
      ok: true,
      slack: slackResult,
      data: {
        shopify_revenue: briefData.shopify.revenue,
        shopify_orders: briefData.shopify.orderCount,
        amazon_revenue: briefData.amazon.revenue,
        amazon_orders: briefData.amazon.orderCount,
        combined_revenue: briefData.shopify.revenue + briefData.amazon.revenue,
        pending_approvals: briefData.approvals,
        pipeline_moves: briefData.pipelineMoves,
        unresolved_errors: briefData.errors.total,
        system_health: briefData.health.status,
        scheduled_agents: briefData.agents.count,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to send morning brief",
      },
      { status: 500 },
    );
  }
}
