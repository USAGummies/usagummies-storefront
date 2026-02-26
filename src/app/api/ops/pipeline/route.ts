/**
 * GET /api/ops/pipeline — Enhanced B2B & Distributor Pipeline from Notion
 *
 * Queries the Notion B2B prospects and distributor databases with:
 * - Pipeline stages with deal counts + values
 * - Pipeline velocity: avg days in each stage
 * - Conversion rates between stages
 * - Recent activity feed
 * - Weekly trend metrics
 */

import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTION_API_KEY = process.env.NOTION_API_KEY || "";
const NOTION_VERSION = "2022-06-28";

const B2B_PROSPECTS_DB = process.env.NOTION_B2B_PROSPECTS_DB || "";
const DISTRIBUTOR_PROSPECTS_DB = process.env.NOTION_DISTRIBUTOR_PROSPECTS_DB || "";

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Notion helpers
// ---------------------------------------------------------------------------

type NotionPage = {
  id: string;
  properties: Record<string, unknown>;
  created_time: string;
  last_edited_time: string;
};

type NotionResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
};

async function queryNotion(
  dbId: string,
  filter?: Record<string, unknown>,
  pageSize = 100,
): Promise<NotionPage[]> {
  if (!NOTION_API_KEY || !dbId) return [];

  try {
    const body: Record<string, unknown> = { page_size: pageSize };
    if (filter) body.filter = filter;

    const res = await fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) return [];
    const data = (await res.json()) as NotionResponse;
    return data.results || [];
  } catch {
    return [];
  }
}

function extractText(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;

  if (p.type === "title" && Array.isArray(p.title)) {
    return (p.title as Array<{ plain_text?: string }>)
      .map((t) => t.plain_text || "")
      .join("");
  }
  if (p.type === "rich_text" && Array.isArray(p.rich_text)) {
    return (p.rich_text as Array<{ plain_text?: string }>)
      .map((t) => t.plain_text || "")
      .join("");
  }
  if (p.type === "select" && p.select && typeof p.select === "object") {
    return (p.select as { name?: string }).name || "";
  }
  if (p.type === "email") return (p.email as string) || "";
  if (p.type === "url") return (p.url as string) || "";
  if (p.type === "number") return String(p.number ?? "");
  if (p.type === "date" && p.date && typeof p.date === "object") {
    return (p.date as { start?: string }).start || "";
  }
  return "";
}

function extractNumber(prop: unknown): number {
  if (!prop || typeof prop !== "object") return 0;
  const p = prop as Record<string, unknown>;
  if (p.type === "number" && typeof p.number === "number") return p.number;
  const textVal = extractText(prop);
  const num = parseFloat(textVal);
  return isNaN(num) ? 0 : num;
}

// ---------------------------------------------------------------------------
// Pipeline lead type
// ---------------------------------------------------------------------------

type PipelineLead = {
  id: string;
  name: string;
  status: string;
  email: string;
  lastContact: string;
  source: string;
  type: "b2b" | "distributor";
  dealValue: number;
  createdAt: string;
  lastEdited: string;
  notes: string;
};

function parseLead(page: NotionPage, type: "b2b" | "distributor"): PipelineLead {
  const props = page.properties;
  return {
    id: page.id,
    name: extractText(props.Name || props.Company || props["Company Name"]),
    status: extractText(
      props.Status || props.Stage || props["Pipeline Stage"],
    ),
    email: extractText(props.Email || props["Contact Email"]),
    lastContact:
      extractText(props["Last Contact"] || props["Last Contacted"]) ||
      page.last_edited_time.slice(0, 10),
    source: extractText(props.Source || props["Lead Source"]),
    type,
    dealValue: extractNumber(
      props["Deal Value"] ||
        props["Estimated Value"] ||
        props["Est. Value"] ||
        props.Value,
    ),
    createdAt: page.created_time,
    lastEdited: page.last_edited_time,
    notes: extractText(props.Notes || props["Follow-up Notes"]),
  };
}

// ---------------------------------------------------------------------------
// Pipeline stage ordering (for funnel analysis)
// ---------------------------------------------------------------------------

const STAGE_ORDER = [
  "New Lead",
  "Lead",
  "Contacted",
  "Interested",
  "Negotiation",
  "Proposal Sent",
  "Closed Won",
  "Closed Lost",
  "Not Interested",
  "Unknown",
];

function stageIndex(stage: string): number {
  const idx = STAGE_ORDER.findIndex(
    (s) => s.toLowerCase() === stage.toLowerCase(),
  );
  return idx >= 0 ? idx : STAGE_ORDER.length - 1;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

type PipelineResult = {
  totalLeads: number;
  b2bCount: number;
  distributorCount: number;
  stageCounts: Record<string, number>;
  stages: Record<string, Omit<PipelineLead, "notes">[]>;
  pipelineValue: { total: number; byStage: Record<string, number> };
  velocity: {
    avgDaysToClose: number;
    avgDaysByStage: Record<string, number>;
  };
  conversionRates: Record<string, number>;
  recentActivity: {
    date: string;
    lead: string;
    event: string;
    details: string;
  }[];
  weeklyTrend: {
    newLeads: number;
    stageAdvances: number;
    closedWon: number;
    closedLost: number;
  };
  generatedAt: string;
};

export async function GET() {
  // Check cache
  const cached = await readState<CacheEnvelope<PipelineResult> | null>(
    "pipeline-cache",
    null,
  );
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  const [b2bPages, distPages] = await Promise.all([
    queryNotion(B2B_PROSPECTS_DB),
    queryNotion(DISTRIBUTOR_PROSPECTS_DB),
  ]);

  const b2bLeads = b2bPages.map((p) => parseLead(p, "b2b"));
  const distLeads = distPages.map((p) => parseLead(p, "distributor"));
  const allLeads = [...b2bLeads, ...distLeads];

  // Group by status
  const stages: Record<string, PipelineLead[]> = {};
  for (const lead of allLeads) {
    const stage = lead.status || "Unknown";
    if (!stages[stage]) stages[stage] = [];
    stages[stage].push(lead);
  }

  // Stage counts
  const stageCounts = Object.fromEntries(
    Object.entries(stages).map(([stage, leads]) => [stage, leads.length]),
  );

  // Pipeline value by stage
  const byStageValue: Record<string, number> = {};
  let totalPipelineValue = 0;
  for (const [stage, leads] of Object.entries(stages)) {
    const stageValue = leads.reduce((sum, l) => sum + l.dealValue, 0);
    byStageValue[stage] = Math.round(stageValue * 100) / 100;
    if (
      !stage.toLowerCase().includes("closed") &&
      !stage.toLowerCase().includes("not interested")
    ) {
      totalPipelineValue += stageValue;
    }
  }

  // Velocity: avg days in current stage
  const avgDaysByStage: Record<string, number> = {};
  for (const [stage, leads] of Object.entries(stages)) {
    if (leads.length === 0) continue;
    const totalDays = leads.reduce((sum, l) => {
      const edited = new Date(l.lastEdited).getTime();
      const now = Date.now();
      return sum + (now - edited) / (1000 * 60 * 60 * 24);
    }, 0);
    avgDaysByStage[stage] = Math.round((totalDays / leads.length) * 10) / 10;
  }

  // Avg days to close (for closed-won deals)
  const closedWon = allLeads.filter((l) =>
    l.status.toLowerCase().includes("closed won"),
  );
  const avgDaysToClose =
    closedWon.length > 0
      ? Math.round(
          (closedWon.reduce((sum, l) => {
            const created = new Date(l.createdAt).getTime();
            const edited = new Date(l.lastEdited).getTime();
            return sum + (edited - created) / (1000 * 60 * 60 * 24);
          }, 0) /
            closedWon.length) *
            10,
        ) / 10
      : 0;

  // Conversion rates between adjacent stages
  const conversionRates: Record<string, number> = {};
  const sortedStages = Object.keys(stages).sort(
    (a, b) => stageIndex(a) - stageIndex(b),
  );
  for (let i = 0; i < sortedStages.length - 1; i++) {
    const from = sortedStages[i];
    const to = sortedStages[i + 1];
    const fromCount = stages[from]?.length || 0;
    const toCount = stages[to]?.length || 0;
    if (fromCount > 0) {
      conversionRates[`${from}\u2192${to}`] =
        Math.round((toCount / (fromCount + toCount)) * 1000) / 10;
    }
  }

  // Recent activity (last 20 leads edited in last 7 days)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentActivity = allLeads
    .filter((l) => new Date(l.lastEdited).getTime() > sevenDaysAgo)
    .sort(
      (a, b) =>
        new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime(),
    )
    .slice(0, 20)
    .map((l) => ({
      date: l.lastEdited.slice(0, 10),
      lead: l.name,
      event: l.status,
      details: l.notes ? l.notes.slice(0, 100) : `${l.type} lead`,
    }));

  // Weekly trend
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklyTrend = {
    newLeads: allLeads.filter(
      (l) => new Date(l.createdAt).getTime() > oneWeekAgo,
    ).length,
    stageAdvances: allLeads.filter(
      (l) => new Date(l.lastEdited).getTime() > oneWeekAgo,
    ).length,
    closedWon: closedWon.filter(
      (l) => new Date(l.lastEdited).getTime() > oneWeekAgo,
    ).length,
    closedLost: allLeads.filter(
      (l) =>
        l.status.toLowerCase().includes("closed lost") &&
        new Date(l.lastEdited).getTime() > oneWeekAgo,
    ).length,
  };

  const result: PipelineResult = {
    totalLeads: allLeads.length,
    b2bCount: b2bLeads.length,
    distributorCount: distLeads.length,
    stageCounts,
    stages: Object.fromEntries(
      Object.entries(stages).map(([stage, leads]) => [
        stage,
        leads.slice(0, 20).map(
          ({
            id,
            name,
            status,
            email,
            lastContact,
            source,
            type,
            dealValue,
            createdAt,
            lastEdited,
          }) => ({
            id,
            name,
            status,
            email,
            lastContact,
            source,
            type,
            dealValue,
            createdAt,
            lastEdited,
          }),
        ),
      ]),
    ),
    pipelineValue: {
      total: Math.round(totalPipelineValue * 100) / 100,
      byStage: byStageValue,
    },
    velocity: { avgDaysToClose, avgDaysByStage },
    conversionRates,
    recentActivity,
    weeklyTrend,
    generatedAt: new Date().toISOString(),
  };

  // Cache
  await writeState("pipeline-cache", { data: result, cachedAt: Date.now() });

  return NextResponse.json(result);
}
