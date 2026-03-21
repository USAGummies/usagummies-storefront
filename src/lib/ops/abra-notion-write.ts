import "server-only";
import { getNotionApiKey, getNotionCredential } from "@/lib/notion/credentials";
import { DB } from "@/lib/notion/client";

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
      `Notion ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
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
}): Promise<{ ok: boolean; error?: string }> {
  if (!NOTION_API_KEY()) return { ok: false, error: "NOTION_API_KEY not configured" };

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

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Provide actionable guidance for the most common failure
    const actionable = msg.includes("object_not_found") || msg.includes("404")
      ? "Page not found — share the Notion page with the OpenClaw Agent integration first (open the page in Notion → Share → Invite → search 'OpenClaw Agent')"
      : msg;
    return { ok: false, error: actionable };
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
      `${baseUrl}/rest/v1/kpi_timeseries?department=eq.${department}&captured_for_date=gte.${encodeURIComponent(since)}&select=metric_name,value,captured_for_date&order=captured_for_date.desc&limit=30`,
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
      value?: number;
      captured_for_date?: string;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) return;

    const body = rows
      .map((row) => `- ${row.metric_name || "metric"}: ${Number(row.value || 0)} (${row.captured_for_date || "n/a"})`)
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

/**
 * Query a Notion database with optional filters.
 * Returns an array of page objects with their properties.
 */
export async function queryNotionDatabase(params: {
  database_id: string;
  filter?: Record<string, unknown>;
  sorts?: Array<Record<string, unknown>>;
  page_size?: number;
}): Promise<Array<Record<string, unknown>>> {
  if (!NOTION_API_KEY()) return [];

  const dbId = toNotionId(params.database_id);
  const body: Record<string, unknown> = {
    page_size: Math.min(params.page_size || 100, 100),
  };
  if (params.filter) body.filter = params.filter;
  if (params.sorts) body.sorts = params.sorts;

  const allResults: Array<Record<string, unknown>> = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore && allResults.length < 500) {
    if (startCursor) body.start_cursor = startCursor;

    const res = await notionFetch(`/databases/${dbId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const results = Array.isArray(res?.results) ? res.results as Array<Record<string, unknown>> : [];
    allResults.push(...results);
    hasMore = res?.has_more === true;
    startCursor = typeof res?.next_cursor === "string" ? res.next_cursor : undefined;
  }

  return allResults;
}

/**
 * Extract a readable value from a Notion property object.
 */
function extractPropertyValue(prop: Record<string, unknown>): unknown {
  const type = prop.type as string;
  switch (type) {
    case "title": {
      const arr = prop.title as Array<Record<string, unknown>> | undefined;
      return arr?.map(t => (t.plain_text || (t.text as Record<string, unknown>)?.content || "")).join("") || "";
    }
    case "rich_text": {
      const arr = prop.rich_text as Array<Record<string, unknown>> | undefined;
      return arr?.map(t => (t.plain_text || (t.text as Record<string, unknown>)?.content || "")).join("") || "";
    }
    case "number":
      return prop.number;
    case "select":
      return (prop.select as Record<string, unknown> | null)?.name || null;
    case "multi_select":
      return (prop.multi_select as Array<Record<string, unknown>>)?.map(s => s.name) || [];
    case "date":
      return (prop.date as Record<string, unknown> | null)?.start || null;
    case "checkbox":
      return prop.checkbox;
    default:
      return null;
  }
}

/**
 * Query the Cash & Transactions ledger and return summarized data.
 * Used by Abra to answer financial questions with real data.
 */
export async function queryLedgerSummary(params?: {
  fiscalYear?: string;
  category?: string;
  accountCode?: string;
}): Promise<{
  transactions: Array<{
    name: string;
    amount: number;
    category: string | null;
    accountCode: string | null;
    vendor: string | null;
    date: string | null;
    fiscalYear: string | null;
    fiscalMonth: string | null;
    status: string | null;
    taxDeductible: boolean | null;
  }>;
  summary: {
    totalExpenses: number;
    totalIncome: number;
    totalCOGS: number;
    totalAllSpend: number;
    totalOwnerInvestment: number;
    netIncome: number;
    byCategory: Record<string, number>;
    byAccountCode: Record<string, number>;
    byFiscalYear: Record<string, number>;
    transactionCount: number;
  };
}> {
  const cashTxDb = DB.CASH_TRANSACTIONS;
  if (!cashTxDb) return { transactions: [], summary: { totalExpenses: 0, totalIncome: 0, totalCOGS: 0, totalAllSpend: 0, totalOwnerInvestment: 0, netIncome: 0, byCategory: {}, byAccountCode: {}, byFiscalYear: {}, transactionCount: 0 } };

  // Build filter
  const conditions: Array<Record<string, unknown>> = [];
  if (params?.fiscalYear) {
    conditions.push({ property: "Fiscal Year", select: { equals: params.fiscalYear } });
  }
  if (params?.category) {
    conditions.push({ property: "Category", select: { equals: params.category } });
  }
  if (params?.accountCode) {
    conditions.push({ property: "Account Code", select: { equals: params.accountCode } });
  }

  const filter = conditions.length > 1
    ? { and: conditions }
    : conditions.length === 1
    ? conditions[0]
    : undefined;

  const pages = await queryNotionDatabase({
    database_id: cashTxDb,
    filter,
    sorts: [{ property: "Date", direction: "ascending" }],
  });

  const transactions: Array<{
    name: string;
    amount: number;
    category: string | null;
    accountCode: string | null;
    vendor: string | null;
    date: string | null;
    fiscalYear: string | null;
    fiscalMonth: string | null;
    status: string | null;
    taxDeductible: boolean | null;
  }> = [];

  let totalExpenses = 0;
  let totalIncome = 0;
  let totalCOGS = 0;
  let totalOwnerInvestment = 0;
  const byCategory: Record<string, number> = {};
  const byAccountCode: Record<string, number> = {};
  const byFiscalYear: Record<string, number> = {};

  for (const page of pages) {
    const props = page.properties as Record<string, Record<string, unknown>> | undefined;
    if (!props) continue;

    const name = extractPropertyValue(props.Name || {}) as string || "";
    const amount = extractPropertyValue(props.Amount || {}) as number || 0;
    const category = extractPropertyValue(props.Category || {}) as string | null;
    const accountCode = extractPropertyValue(props["Account Code"] || {}) as string | null;
    const vendor = extractPropertyValue(props.Vendor || {}) as string | null;
    const date = extractPropertyValue(props.Date || {}) as string | null;
    const fiscalYear = extractPropertyValue(props["Fiscal Year"] || {}) as string | null;
    const fiscalMonth = extractPropertyValue(props["Fiscal Month"] || {}) as string | null;
    const status = extractPropertyValue(props.Status || {}) as string | null;
    const taxDeductible = extractPropertyValue(props["Tax Deductible"] || {}) as boolean | null;
    const txType = extractPropertyValue(props.Type || {}) as string | null;

    transactions.push({ name, amount, category, accountCode, vendor, date, fiscalYear, fiscalMonth, status, taxDeductible });

    const absAmount = Math.abs(amount);
    const txLower = (txType || "").toLowerCase();
    const catLower = (category || "").toLowerCase();
    const isTransfer = catLower === "transfer" || txLower === "transfer";
    const isRefund = catLower === "refund" || txLower === "refund";
    const isCOGS = txLower === "cogs" || catLower === "cogs" || (accountCode?.startsWith("5") && !accountCode?.startsWith("50"));
    const isIncome = catLower === "income" || txLower === "income" || (accountCode?.startsWith("41"));

    if (isTransfer) {
      // Owner investments / capital injections — NOT revenue
      totalOwnerInvestment += absAmount;
    } else if (isRefund) {
      // Refunds excluded from P&L totals (net against revenue separately)
    } else if (isIncome) {
      totalIncome += absAmount;
    } else if (isCOGS) {
      totalCOGS += absAmount;
    } else if (catLower === "expense" || txLower === "expense" || accountCode?.startsWith("6") || accountCode?.startsWith("7")) {
      totalExpenses += absAmount;
    }

    if (category) byCategory[category] = (byCategory[category] || 0) + absAmount;
    if (accountCode) byAccountCode[accountCode] = (byAccountCode[accountCode] || 0) + absAmount;
    if (fiscalYear) byFiscalYear[fiscalYear] = (byFiscalYear[fiscalYear] || 0) + absAmount;
  }

  const totalAllSpend = Math.round((totalExpenses + totalCOGS) * 100) / 100;
  return {
    transactions,
    summary: {
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalCOGS: Math.round(totalCOGS * 100) / 100,
      totalAllSpend,
      totalOwnerInvestment: Math.round(totalOwnerInvestment * 100) / 100,
      netIncome: Math.round((totalIncome - totalAllSpend) * 100) / 100,
      byCategory,
      byAccountCode,
      byFiscalYear,
      transactionCount: transactions.length,
    },
  };
}
