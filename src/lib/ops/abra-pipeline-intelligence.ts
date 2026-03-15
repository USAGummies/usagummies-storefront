import { emitSignal } from "@/lib/ops/abra-operational-signals";
import { proposeAndMaybeExecute } from "@/lib/ops/abra-actions";
import { recordKPI } from "@/lib/ops/abra-kpi-recorder";

type NotionPage = {
  id: string;
  properties: Record<string, unknown>;
  created_time: string;
  last_edited_time: string;
};

type NotionQueryResponse = {
  results?: NotionPage[];
  has_more?: boolean;
  next_cursor?: string | null;
};

type DealRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  status: string;
  value: number | string | null;
  stage: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type NotionDeal = {
  pageId: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  stage: string;
  status: string;
  value: number;
  notes: string | null;
  updated_at: string;
};

export type DealInsight = {
  deal_id: string;
  company_name: string;
  stage: string;
  value: number;
  days_in_stage: number;
  risk_level: "low" | "medium" | "high";
  recommended_action: string;
  last_activity: string;
};

export type PipelineSummary = {
  total_pipeline_value: number;
  deals_by_stage: Record<string, { count: number; value: number }>;
  /** All active deal insights (for detailed per-deal reporting) */
  all_active_deals: DealInsight[];
  at_risk_deals: DealInsight[];
  stale_deals: DealInsight[];
  hot_deals: DealInsight[];
  win_rate_30d: number;
  avg_deal_cycle_days: number;
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
  return json;
}

function toNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractText(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if (p.type === "title" && Array.isArray(p.title)) {
    return (p.title as Array<{ plain_text?: string }>)
      .map((item) => item.plain_text || "")
      .join("");
  }
  if (p.type === "rich_text" && Array.isArray(p.rich_text)) {
    return (p.rich_text as Array<{ plain_text?: string }>)
      .map((item) => item.plain_text || "")
      .join("");
  }
  if (p.type === "select" && p.select && typeof p.select === "object") {
    return ((p.select as { name?: string }).name || "").trim();
  }
  if (p.type === "email") return String(p.email || "");
  if (p.type === "number") return String(p.number ?? "");
  if (p.type === "date" && p.date && typeof p.date === "object") {
    return String((p.date as { start?: string }).start || "");
  }
  return "";
}

function daysBetween(fromIso: string, toIso = new Date().toISOString()): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / (1000 * 60 * 60 * 24)));
}

function recommendedAction(stage: string, daysInStage: number): string {
  const normalized = stage.toLowerCase().replace(/\s+/g, "_");
  if (normalized.includes("prospecting") && daysInStage > 7) {
    return "Send follow-up email";
  }
  if (normalized.includes("proposal") && daysInStage > 5) {
    return "Schedule check-in call";
  }
  if (normalized.includes("negotiation") && daysInStage > 10) {
    return "Escalate — deal may be stalling";
  }
  if (normalized.includes("verbal") && daysInStage > 3) {
    return "Send contract for signature";
  }
  return "Maintain momentum with next touchpoint";
}

function toInsight(deal: DealRow): DealInsight {
  const stage = (deal.stage || deal.status || "unknown").toString();
  const daysInStage = daysBetween(deal.updated_at || deal.created_at);
  const riskLevel: DealInsight["risk_level"] =
    daysInStage > 14 ? "high" : daysInStage > 7 ? "medium" : "low";
  return {
    deal_id: deal.id,
    company_name: deal.company_name || "Unknown company",
    stage,
    value: toNumber(deal.value),
    days_in_stage: daysInStage,
    risk_level: riskLevel,
    recommended_action: recommendedAction(stage, daysInStage),
    last_activity: deal.updated_at || deal.created_at,
  };
}

async function fetchDeals(filterClosed: "active" | "all"): Promise<DealRow[]> {
  const statusFilter =
    filterClosed === "active" ? "&status=not.in.(closed_won,closed_lost)" : "";
  try {
    const rows = (await sbFetch(
      `/rest/v1/abra_deals?select=id,company_name,contact_name,contact_email,status,value,stage,notes,created_at,updated_at&order=value.desc,updated_at.desc&limit=5000${statusFilter}`,
    )) as DealRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function normalizeStage(status: string): string {
  const raw = (status || "").trim().toLowerCase();
  if (!raw) return "prospecting";
  return raw.replace(/\s+/g, "_");
}

function leadStatusFromStage(stage: string): string {
  if (stage.includes("closed_won")) return "closed_won";
  if (stage.includes("closed_lost")) return "closed_lost";
  return "active";
}

async function queryNotionDatabase(databaseId: string): Promise<NotionPage[]> {
  const notionKey = process.env.NOTION_API_KEY;
  if (!notionKey || !databaseId) return [];
  const all: NotionPage[] = [];
  let cursor: string | null = null;

  for (let i = 0; i < 20; i += 1) {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${databaseId.replace(/-/g, "")}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!res.ok) break;
    const data = (await res.json()) as NotionQueryResponse;
    all.push(...(Array.isArray(data.results) ? data.results : []));
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return all;
}

function parseNotionDeal(page: NotionPage): NotionDeal {
  const props = page.properties || {};
  const company = extractText(
    (props as Record<string, unknown>)["Business Name"] ||
      (props as Record<string, unknown>)["Company Name"] ||
      (props as Record<string, unknown>).Company ||
      (props as Record<string, unknown>).Name,
  );
  const contact = extractText(
    (props as Record<string, unknown>)["Contact Name"] ||
      (props as Record<string, unknown>)["Primary Contact"] ||
      (props as Record<string, unknown>).Name,
  );
  const email = extractText(
    (props as Record<string, unknown>)["Email Address"] ||
      (props as Record<string, unknown>).Email ||
      (props as Record<string, unknown>)["Contact Email"],
  );
  const stage = extractText(
    (props as Record<string, unknown>).Status ||
      (props as Record<string, unknown>)["Pipeline Stage"] ||
      (props as Record<string, unknown>).Stage,
  );
  const value = toNumber(
    extractText(
      (props as Record<string, unknown>)["Order Value"] ||
        (props as Record<string, unknown>)["Quote Amount"] ||
        (props as Record<string, unknown>)["Deal Value"] ||
        (props as Record<string, unknown>)["Estimated Value"],
    ),
  );
  const notes = extractText(
    (props as Record<string, unknown>).Notes ||
      (props as Record<string, unknown>)["Follow-up Notes"] ||
      (props as Record<string, unknown>)["Reply Summary"],
  );

  return {
    pageId: page.id,
    company_name: company || contact || "Unknown company",
    contact_name: contact || null,
    contact_email: email || null,
    stage: normalizeStage(stage),
    status: leadStatusFromStage(normalizeStage(stage)),
    value,
    notes: notes || null,
    updated_at: page.last_edited_time,
  };
}

async function loadNotionDealsFallback(): Promise<DealRow[]> {
  const notionKey = process.env.NOTION_API_KEY;
  const b2bDb = process.env.NOTION_B2B_PROSPECTS_DB;
  const distDb = process.env.NOTION_DISTRIBUTOR_PROSPECTS_DB;
  if (!notionKey || (!b2bDb && !distDb)) return [];

  const pages = [
    ...(b2bDb ? await queryNotionDatabase(b2bDb) : []),
    ...(distDb ? await queryNotionDatabase(distDb) : []),
  ];
  if (pages.length === 0) return [];

  return pages.map(parseNotionDeal).map((deal) => ({
    id: `notion:${deal.pageId}`,
    company_name: deal.company_name,
    contact_name: deal.contact_name,
    contact_email: deal.contact_email,
    status: deal.status,
    value: deal.value,
    stage: deal.stage,
    notes: deal.notes,
    created_at: deal.updated_at,
    updated_at: deal.updated_at,
  }));
}

export async function analyzePipeline(): Promise<PipelineSummary> {
  let activeDeals = await fetchDeals("active");
  let allDeals = await fetchDeals("all");
  if (activeDeals.length === 0 && allDeals.length === 0) {
    const fallbackDeals = await loadNotionDealsFallback();
    if (fallbackDeals.length > 0) {
      allDeals = fallbackDeals;
      activeDeals = fallbackDeals.filter((deal) => {
        const status = (deal.status || "").toLowerCase();
        return status !== "closed_won" && status !== "closed_lost";
      });
    }
  }

  const insights = activeDeals.map(toInsight);
  const dealsByStage: Record<string, { count: number; value: number }> = {};
  let totalPipelineValue = 0;

  for (const insight of insights) {
    const stage = insight.stage || "unknown";
    if (!dealsByStage[stage]) {
      dealsByStage[stage] = { count: 0, value: 0 };
    }
    dealsByStage[stage].count += 1;
    dealsByStage[stage].value += insight.value;
    totalPipelineValue += insight.value;
  }

  const staleDeals = insights.filter((insight) => insight.days_in_stage > 7);
  const atRiskDeals = insights.filter((insight) => insight.risk_level === "high");
  const hotDeals = insights.filter(
    (insight) => insight.days_in_stage < 3 && insight.value > 500,
  );

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentClosedWon = allDeals.filter(
    (deal) => deal.status === "closed_won" && deal.updated_at >= since,
  );
  const recentClosedLost = allDeals.filter(
    (deal) => deal.status === "closed_lost" && deal.updated_at >= since,
  );
  const winDenominator = recentClosedWon.length + recentClosedLost.length;
  const winRate = winDenominator > 0 ? (recentClosedWon.length / winDenominator) * 100 : 0;

  const cycleDays = recentClosedWon
    .map((deal) => daysBetween(deal.created_at, deal.updated_at))
    .filter((value) => Number.isFinite(value));
  const avgDealCycle =
    cycleDays.length > 0
      ? cycleDays.reduce((sum, value) => sum + value, 0) / cycleDays.length
      : 0;

  return {
    total_pipeline_value: Math.round(totalPipelineValue * 100) / 100,
    deals_by_stage: Object.fromEntries(
      Object.entries(dealsByStage).map(([stage, data]) => [
        stage,
        { count: data.count, value: Math.round(data.value * 100) / 100 },
      ]),
    ),
    all_active_deals: insights.slice(0, 200),
    at_risk_deals: atRiskDeals.slice(0, 25),
    stale_deals: staleDeals.slice(0, 50),
    hot_deals: hotDeals.slice(0, 25),
    win_rate_30d: Math.round(winRate * 100) / 100,
    avg_deal_cycle_days: Math.round(avgDealCycle * 100) / 100,
  };
}

export async function checkDealHealth(): Promise<{
  signals_emitted: number;
  proposals_created: number;
}> {
  const summary = await analyzePipeline();
  const activeDeals = await fetchDeals("active");
  const byId = new Map(activeDeals.map((deal) => [deal.id, deal]));
  let signalsEmitted = 0;
  let proposalsCreated = 0;

  for (const deal of summary.at_risk_deals) {
    const signalId = await emitSignal({
      signal_type: "deal_stalled",
      source: "pipeline",
      title: `Deal stalled: ${deal.company_name}`,
      detail: `Stage: ${deal.stage}, ${deal.days_in_stage} days. Recommended: ${deal.recommended_action}`,
      severity: "warning",
      department: "sales_and_growth",
      metadata: {
        deal_id: deal.deal_id,
        stage: deal.stage,
        days_in_stage: deal.days_in_stage,
        value: deal.value,
      },
    });
    if (signalId) signalsEmitted += 1;
  }

  for (const deal of summary.stale_deals) {
    const stage = deal.stage.toLowerCase();
    if (!(stage.includes("prospecting") || stage.includes("proposal"))) continue;
    const row = byId.get(deal.deal_id);
    const email = row?.contact_email;
    if (!email) continue;

    try {
      const proposal = await proposeAndMaybeExecute({
        action_type: "send_email",
        title: `Follow up: ${deal.company_name}`,
        description: `Follow up with ${row?.contact_name || "contact"} at ${deal.company_name}`,
        department: "sales_and_growth",
        risk_level: "low",
        requires_approval: true,
        confidence: 0.7,
        params: {
          to: email,
          subject: `Following up on USA Gummies proposal`,
          body:
            `Hi ${row?.contact_name || "there"},\n\n` +
            `Quick follow-up on our conversation with USA Gummies. ` +
          `Happy to answer questions and align next steps this week.\n\nBest,\nBen`,
        },
      });
      if (proposal.approval_id) proposalsCreated += 1;
    } catch {
      // best-effort proposal
    }
  }

  try {
    await Promise.all([
      recordKPI({
        metric_name: "pipeline_total_value",
        value: summary.total_pipeline_value,
        department: "sales_and_growth",
        source_system: "calculated",
        metric_group: "sales",
      }),
      recordKPI({
        metric_name: "pipeline_at_risk_count",
        value: summary.at_risk_deals.length,
        department: "sales_and_growth",
        source_system: "calculated",
        metric_group: "sales",
      }),
    ]);
  } catch {
    // best-effort KPI writes
  }

  return { signals_emitted: signalsEmitted, proposals_created: proposalsCreated };
}

/**
 * LLM-powered pipeline analysis: generates personalized follow-up strategies
 * and deal momentum assessments for each at-risk or stale deal.
 * Falls back to rule-based recommendations if LLM unavailable.
 */
export async function generateLLMDealInsights(
  summary?: PipelineSummary,
): Promise<{
  deal_strategies: Array<{
    deal_id: string;
    company_name: string;
    follow_up_message: string;
    momentum_assessment: string;
    risk_factors: string[];
    next_action: string;
  }>;
  pipeline_narrative: string;
}> {
  const pipeline = summary || (await analyzePipeline());
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey || pipeline.all_active_deals.length === 0) {
    return {
      deal_strategies: [],
      pipeline_narrative: `Pipeline: $${pipeline.total_pipeline_value.toLocaleString()} across ${pipeline.all_active_deals.length} deals. ${pipeline.at_risk_deals.length} at risk.`,
    };
  }

  const FALLBACK_PROMPT = `You are the B2B sales strategist for USA Gummies, a CPG vitamin gummy company.

Given the current pipeline data, generate:
1. A brief pipeline narrative (2-3 sentences summarizing health, momentum, and priorities)
2. For each at-risk or stale deal, a personalized follow-up strategy

For each deal strategy, provide:
- follow_up_message: A personalized 2-3 sentence email body Ben can send (casual but professional)
- momentum_assessment: One sentence on whether this deal is gaining or losing momentum
- risk_factors: Array of 1-3 specific risk factors
- next_action: The single most important next step

Respond in JSON:
{
  "pipeline_narrative": "...",
  "deal_strategies": [
    {
      "deal_id": "...",
      "company_name": "...",
      "follow_up_message": "...",
      "momentum_assessment": "...",
      "risk_factors": ["..."],
      "next_action": "..."
    }
  ]
}

Rules:
- Never fabricate deal details not in the data
- Keep follow-ups warm and founder-appropriate (not corporate/salesy)
- Reference specific deal context (stage, days, value) in assessments
- Max 10 deal strategies (prioritize highest value and highest risk)`;

  let systemPrompt = FALLBACK_PROMPT;
  try {
    const { getActivePrompt } = await import("@/lib/ops/auto-research-runner");
    const versioned = await getActivePrompt("pipeline_intel");
    if (versioned?.prompt_text) {
      systemPrompt = versioned.prompt_text;
    }
  } catch {
    // fallback
  }

  try {
    const { getPreferredClaudeModel } = await import("@/lib/ops/abra-cost-tracker");
    const model = await getPreferredClaudeModel(
      process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6-20260315",
    );

    const dealsForAnalysis = [
      ...pipeline.at_risk_deals,
      ...pipeline.stale_deals.filter(
        (d) => !pipeline.at_risk_deals.some((ar) => ar.deal_id === d.deal_id),
      ),
      ...pipeline.hot_deals,
    ].slice(0, 15);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0.3,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Analyze this pipeline:\n\nSummary: $${pipeline.total_pipeline_value} total, ${pipeline.all_active_deals.length} active deals, ${pipeline.at_risk_deals.length} at risk, win rate ${pipeline.win_rate_30d}%, avg cycle ${pipeline.avg_deal_cycle_days} days\n\nDeals to analyze:\n${JSON.stringify(dealsForAnalysis, null, 2)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      return {
        deal_strategies: [],
        pipeline_narrative: `Pipeline: $${pipeline.total_pipeline_value.toLocaleString()} across ${pipeline.all_active_deals.length} deals.`,
      };
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    // Log cost
    try {
      const { logAICost } = await import("@/lib/ops/abra-cost-tracker");
      if (data.usage) {
        await logAICost({
          model,
          provider: "anthropic",
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          endpoint: "pipeline-intelligence",
          department: "sales_and_growth",
        });
      }
    } catch {
      // best-effort
    }

    const text = data.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text || "")
      .join("");

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          pipeline_narrative: string;
          deal_strategies: Array<{
            deal_id: string;
            company_name: string;
            follow_up_message: string;
            momentum_assessment: string;
            risk_factors: string[];
            next_action: string;
          }>;
        };
        return {
          pipeline_narrative: parsed.pipeline_narrative || "",
          deal_strategies: Array.isArray(parsed.deal_strategies) ? parsed.deal_strategies : [],
        };
      }
    } catch {
      // parse failed
    }

    return {
      deal_strategies: [],
      pipeline_narrative: `Pipeline: $${pipeline.total_pipeline_value.toLocaleString()} across ${pipeline.all_active_deals.length} deals.`,
    };
  } catch {
    return {
      deal_strategies: [],
      pipeline_narrative: `Pipeline: $${pipeline.total_pipeline_value.toLocaleString()} across ${pipeline.all_active_deals.length} deals.`,
    };
  }
}

export async function syncNotionDeals(): Promise<{
  synced: number;
  new: number;
  updated: number;
}> {
  const notionKey = process.env.NOTION_API_KEY;
  const b2bDb = process.env.NOTION_B2B_PROSPECTS_DB;
  const distDb = process.env.NOTION_DISTRIBUTOR_PROSPECTS_DB;
  if (!notionKey || (!b2bDb && !distDb)) {
    return { synced: 0, new: 0, updated: 0 };
  }

  const pages = [
    ...(b2bDb ? await queryNotionDatabase(b2bDb) : []),
    ...(distDb ? await queryNotionDatabase(distDb) : []),
  ];
  if (pages.length === 0) return { synced: 0, new: 0, updated: 0 };

  const notionDeals = pages.map(parseNotionDeal);
  let existingRows: DealRow[] = [];
  try {
    existingRows = (await sbFetch(
      "/rest/v1/abra_deals?select=id,company_name,contact_name,contact_email,status,value,stage,notes,created_at,updated_at&limit=5000",
    )) as DealRow[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("abra_deals") && message.includes("(404)")) {
      return { synced: notionDeals.length, new: 0, updated: 0 };
    }
    throw error;
  }
  const existingByCompany = new Map(
    (Array.isArray(existingRows) ? existingRows : []).map((row) => [
      (row.company_name || "").toLowerCase(),
      row,
    ]),
  );

  let inserted = 0;
  let updated = 0;
  let synced = 0;

  for (const deal of notionDeals) {
    const key = deal.company_name.toLowerCase();
    if (!key) continue;
    const existing = existingByCompany.get(key);
    synced += 1;

    if (!existing) {
      await sbFetch("/rest/v1/abra_deals", {
        method: "POST",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_name: deal.company_name,
          contact_name: deal.contact_name,
          contact_email: deal.contact_email,
          status: deal.status,
          value: deal.value,
          stage: deal.stage,
          notes: deal.notes,
          department: "sales_and_growth",
        }),
      });
      inserted += 1;
      continue;
    }

    const needsUpdate =
      (existing.contact_name || "") !== (deal.contact_name || "") ||
      (existing.contact_email || "") !== (deal.contact_email || "") ||
      (existing.status || "") !== deal.status ||
      toNumber(existing.value) !== toNumber(deal.value) ||
      (existing.stage || "") !== deal.stage ||
      (existing.notes || "") !== (deal.notes || "");

    if (needsUpdate) {
      await sbFetch(`/rest/v1/abra_deals?id=eq.${existing.id}`, {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_name: deal.company_name,
          contact_name: deal.contact_name,
          contact_email: deal.contact_email,
          status: deal.status,
          value: deal.value,
          stage: deal.stage,
          notes: deal.notes,
          updated_at: new Date().toISOString(),
        }),
      });
      updated += 1;
    }
  }

  return { synced, new: inserted, updated };
}
