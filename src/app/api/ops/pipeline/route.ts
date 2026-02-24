/**
 * GET /api/ops/pipeline — B2B & Distributor Pipeline from Notion
 *
 * Queries the Notion B2B prospects and distributor databases
 * to show pipeline stages, deal counts, and recent activity.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTION_API_KEY = process.env.NOTION_API_KEY || "";
const NOTION_VERSION = "2022-06-28";

// Notion DB IDs (from the B2B engine config)
const B2B_PROSPECTS_DB = process.env.NOTION_B2B_PROSPECTS_DB || "";
const DISTRIBUTOR_PROSPECTS_DB = process.env.NOTION_DISTRIBUTOR_PROSPECTS_DB || "";

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

async function queryNotion(dbId: string, filter?: Record<string, unknown>, pageSize = 100): Promise<NotionPage[]> {
  if (!NOTION_API_KEY || !dbId) return [];

  try {
    const body: Record<string, unknown> = { page_size: pageSize };
    if (filter) body.filter = filter;

    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

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
    return (p.title as Array<{ plain_text?: string }>).map((t) => t.plain_text || "").join("");
  }
  if (p.type === "rich_text" && Array.isArray(p.rich_text)) {
    return (p.rich_text as Array<{ plain_text?: string }>).map((t) => t.plain_text || "").join("");
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

type PipelineLead = {
  id: string;
  name: string;
  status: string;
  email: string;
  lastContact: string;
  source: string;
  type: "b2b" | "distributor";
};

function parseLead(page: NotionPage, type: "b2b" | "distributor"): PipelineLead {
  const props = page.properties;
  return {
    id: page.id,
    name: extractText(props.Name || props.Company || props["Company Name"]),
    status: extractText(props.Status || props.Stage || props["Pipeline Stage"]),
    email: extractText(props.Email || props["Contact Email"]),
    lastContact: extractText(props["Last Contact"] || props["Last Contacted"]) || page.last_edited_time.slice(0, 10),
    source: extractText(props.Source || props["Lead Source"]),
    type,
  };
}

export async function GET() {
  const [b2bPages, distPages] = await Promise.all([
    queryNotion(B2B_PROSPECTS_DB),
    queryNotion(DISTRIBUTOR_PROSPECTS_DB),
  ]);

  const b2bLeads = b2bPages.map((p) => parseLead(p, "b2b"));
  const distLeads = distPages.map((p) => parseLead(p, "distributor"));
  const allLeads = [...b2bLeads, ...distLeads];

  // Group by status for pipeline stages
  const stages: Record<string, PipelineLead[]> = {};
  for (const lead of allLeads) {
    const stage = lead.status || "Unknown";
    if (!stages[stage]) stages[stage] = [];
    stages[stage].push(lead);
  }

  // Stage counts
  const stageCounts = Object.fromEntries(
    Object.entries(stages).map(([stage, leads]) => [stage, leads.length])
  );

  return NextResponse.json({
    totalLeads: allLeads.length,
    b2bCount: b2bLeads.length,
    distributorCount: distLeads.length,
    stageCounts,
    stages: Object.fromEntries(
      Object.entries(stages).map(([stage, leads]) => [
        stage,
        leads.slice(0, 20).map(({ id, name, status, email, lastContact, type }) => ({
          id,
          name,
          status,
          email,
          lastContact,
          type,
        })),
      ])
    ),
    generatedAt: new Date().toISOString(),
  });
}
