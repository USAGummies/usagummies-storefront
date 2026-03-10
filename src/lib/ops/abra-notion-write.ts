import "server-only";
import { getNotionApiKey, getNotionCredential } from "@/lib/notion/credentials";

const NOTION_VERSION = "2022-06-28";
const NOTION_API_KEY = () => getNotionApiKey();

function toNotionId(raw: string): string {
  const clean = raw.replace(/-/g, "").trim();
  if (clean.length !== 32) return raw.trim();
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function notionUrlFromId(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, "")}`;
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_API_KEY()}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionFetch(path: string, init: RequestInit = {}) {
  const key = NOTION_API_KEY();
  if (!key) throw new Error("NOTION_API_KEY not configured");

  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      ...notionHeaders(),
      ...(init.headers || {}),
    },
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(20000),
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
      `Notion ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }
  return json as Record<string, unknown>;
}

function isNotionPropValue(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.some((key) =>
    [
      "title",
      "rich_text",
      "number",
      "select",
      "multi_select",
      "date",
      "checkbox",
      "url",
      "email",
      "phone_number",
      "status",
      "people",
    ].includes(key),
  );
}

function normalizePropertyValue(value: unknown) {
  if (isNotionPropValue(value)) return value;

  if (typeof value === "number") return { number: value };
  if (typeof value === "boolean") return { checkbox: value };
  if (typeof value === "string") {
    return { rich_text: [{ text: { content: value.slice(0, 1900) } }] };
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return {
      multi_select: value.map((v) => ({ name: v.slice(0, 100) })),
    };
  }
  return {
    rich_text: [
      {
        text: {
          content:
            typeof value === "undefined"
              ? ""
              : JSON.stringify(value).slice(0, 1900),
        },
      },
    ],
  };
}

function normalizeProperties(properties?: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (!properties) return out;
  for (const [key, value] of Object.entries(properties)) {
    out[key] = normalizePropertyValue(value);
  }
  return out;
}

function markdownToBlocks(content: string): Record<string, unknown>[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: Record<string, unknown>[] = [];

  for (const line of lines.slice(0, 100)) {
    if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: line.slice(4) } }],
        },
      });
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: line.slice(3) } }],
        },
      });
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({
        object: "block",
        type: "heading_1",
        heading_1: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      });
      continue;
    }
    if (line.startsWith("- ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      });
      continue;
    }
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: line } }],
      },
    });
  }

  return blocks;
}

async function getDatabaseTitleProperty(databaseId: string): Promise<string | null> {
  try {
    const db = await notionFetch(`/databases/${toNotionId(databaseId)}`);
    const properties =
      db && typeof db === "object" && db.properties && typeof db.properties === "object"
        ? (db.properties as Record<string, Record<string, unknown>>)
        : {};
    for (const [name, prop] of Object.entries(properties)) {
      if (prop?.type === "title") return name;
    }
    return null;
  } catch {
    return null;
  }
}

export async function createNotionPage(params: {
  parent_id: string;
  title: string;
  content?: string;
  properties?: Record<string, unknown>;
}): Promise<string | null> {
  if (!NOTION_API_KEY()) return null;

  const parentId = toNotionId(params.parent_id);
  const blocks = params.content ? markdownToBlocks(params.content) : undefined;
  const baseProperties = normalizeProperties(params.properties);

  // Attempt as database parent first, then page parent fallback.
  const titleProperty = await getDatabaseTitleProperty(parentId);
  const parentVariants: Array<Record<string, string>> = titleProperty
    ? [{ database_id: parentId }, { page_id: parentId }]
    : [{ page_id: parentId }, { database_id: parentId }];

  for (const parent of parentVariants) {
    try {
      const properties = { ...baseProperties };
      if ("database_id" in parent && titleProperty && !properties[titleProperty]) {
        properties[titleProperty] = {
          title: [{ text: { content: params.title.slice(0, 120) } }],
        };
      }
      if ("page_id" in parent) {
        properties.title = {
          title: [{ text: { content: params.title.slice(0, 120) } }],
        };
      }

      const payload: Record<string, unknown> = {
        parent,
        properties,
      };
      if (blocks && blocks.length > 0) {
        payload.children = blocks;
      }

      const created = await notionFetch("/pages", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const id = typeof created?.id === "string" ? created.id : null;
      if (id) return id;
    } catch {
      // Try next parent variant.
    }
  }

  return null;
}

export async function updateNotionPage(params: {
  page_id: string;
  properties?: Record<string, unknown>;
  content?: string;
}): Promise<boolean> {
  if (!NOTION_API_KEY()) return false;

  try {
    if (params.properties && Object.keys(params.properties).length > 0) {
      await notionFetch(`/pages/${toNotionId(params.page_id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          properties: normalizeProperties(params.properties),
        }),
      });
    }

    if (params.content) {
      const blocks = markdownToBlocks(params.content);
      if (blocks.length > 0) {
        await notionFetch(`/blocks/${toNotionId(params.page_id)}/children`, {
          method: "PATCH",
          body: JSON.stringify({ children: blocks }),
        });
      }
    }

    return true;
  } catch {
    return false;
  }
}

export async function createMeetingNotesPage(session: {
  title: string;
  department: string;
  notes: unknown[];
  decisions: unknown[];
  action_items: unknown[];
  started_at: string;
  ended_at: string;
}): Promise<string | null> {
  const meetingDb =
    getNotionCredential("NOTION_MEETING_NOTES_DB_ID") ||
    getNotionCredential("NOTION_MEETING_DB_ID");
  if (!meetingDb) return null;

  const toBulletLines = (rows: unknown[]) =>
    rows.length > 0
      ? rows
          .slice(0, 50)
          .map((row) => `- ${typeof row === "string" ? row : JSON.stringify(row)}`)
          .join("\n")
      : "- None";

  const content = [
    `# ${session.title}`,
    `## Department`,
    `- ${session.department}`,
    `## Started`,
    `- ${session.started_at}`,
    `## Ended`,
    `- ${session.ended_at}`,
    `## Notes`,
    toBulletLines(session.notes || []),
    `## Decisions`,
    toBulletLines(session.decisions || []),
    `## Action Items`,
    toBulletLines(session.action_items || []),
  ].join("\n");

  const pageId = await createNotionPage({
    parent_id: meetingDb,
    title: session.title,
    content,
  });
  return pageId;
}

export async function syncKPIsToNotion(department: string): Promise<void> {
  const kpiDb = getNotionCredential("NOTION_KPI_DB");
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!kpiDb || !baseUrl || !serviceKey) return;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(
      `${baseUrl}/rest/v1/kpi_timeseries?department=eq.${department}&recorded_at=gte.${encodeURIComponent(since)}&select=metric_name,metric_value,recorded_at&order=recorded_at.desc&limit=30`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return;
    const rows = (await res.json()) as Array<{
      metric_name?: string;
      metric_value?: number;
      recorded_at?: string;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) return;

    const body = rows
      .map((row) => `- ${row.metric_name || "metric"}: ${Number(row.metric_value || 0)} (${row.recorded_at || "n/a"})`)
      .join("\n");

    await createNotionPage({
      parent_id: kpiDb,
      title: `KPI Sync — ${department} — ${new Date().toISOString().slice(0, 10)}`,
      content: `# KPI Sync\n## Department\n- ${department}\n## Latest Values\n${body}`,
    });
  } catch {
    // Best-effort sync.
  }
}

export function notionPageUrlFromId(pageId: string): string {
  return notionUrlFromId(pageId);
}
