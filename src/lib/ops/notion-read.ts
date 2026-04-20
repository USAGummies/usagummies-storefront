/**
 * Thin Notion read helper for specialist runtimes.
 *
 * Uses the Notion-internal integration token (`NOTION_TOKEN` or
 * `NOTION_API_KEY` on Vercel) to query databases the team already
 * shares with the integration. We keep this helper focused on the
 * minimum surface specialists need (search + database query);
 * scripts that need more go straight to `@notionhq/client`.
 */

function getToken(): string | null {
  return (
    process.env.NOTION_TOKEN?.trim() ||
    process.env.NOTION_API_KEY?.trim() ||
    null
  );
}

export function isNotionConfigured(): boolean {
  return getToken() !== null;
}

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

async function notionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error("NOTION_TOKEN not configured");
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": VERSION,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export interface NotionSearchResult {
  id: string;
  title: string;
  url: string;
  object: "page" | "database";
  lastEditedTime: string;
}

/**
 * Search the workspace for a page/database matching a query string.
 * Returns the most-relevant result per Notion's built-in scoring.
 */
export async function notionSearch(
  query: string,
  filterObject?: "page" | "database",
  pageSize = 10,
): Promise<NotionSearchResult[]> {
  const body: Record<string, unknown> = { query, page_size: pageSize };
  if (filterObject) body.filter = { property: "object", value: filterObject };
  const res = await notionFetch("/search", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Notion search ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<Record<string, unknown>>;
  };
  return (data.results ?? [])
    .map((raw): NotionSearchResult | null => {
      const object = raw.object as "page" | "database" | undefined;
      if (object !== "page" && object !== "database") return null;
      const id = String(raw.id ?? "");
      const url = String(raw.url ?? "");
      const lastEditedTime = String(raw.last_edited_time ?? "");
      const title = extractTitle(raw) ?? "(untitled)";
      return { id, title, url, object, lastEditedTime };
    })
    .filter((r): r is NotionSearchResult => r !== null);
}

function extractTitle(raw: Record<string, unknown>): string | null {
  const props = raw.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const value of Object.values(props)) {
      const v = value as { type?: string; title?: Array<{ plain_text?: string }> };
      if (v?.type === "title" && Array.isArray(v.title)) {
        return v.title.map((t) => t.plain_text ?? "").join("") || null;
      }
    }
  }
  const titleArr = raw.title as Array<{ plain_text?: string }> | undefined;
  if (Array.isArray(titleArr)) return titleArr.map((t) => t.plain_text ?? "").join("") || null;
  return null;
}

export interface NotionDatabasePage {
  id: string;
  url: string;
  properties: Record<string, unknown>;
  lastEditedTime: string;
}

/**
 * Query a database (by id) with an optional filter + sort. Returns
 * raw pages so the caller decides how to interpret each row's
 * properties.
 */
export async function queryDatabase(
  databaseId: string,
  opts: {
    filter?: Record<string, unknown>;
    sorts?: Array<Record<string, unknown>>;
    pageSize?: number;
  } = {},
): Promise<NotionDatabasePage[]> {
  const body: Record<string, unknown> = { page_size: opts.pageSize ?? 100 };
  if (opts.filter) body.filter = opts.filter;
  if (opts.sorts) body.sorts = opts.sorts;
  const res = await notionFetch(`/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion query ${res.status}`);
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).map((raw) => ({
    id: String(raw.id ?? ""),
    url: String(raw.url ?? ""),
    properties: (raw.properties as Record<string, unknown>) ?? {},
    lastEditedTime: String(raw.last_edited_time ?? ""),
  }));
}

/**
 * Pull a single scalar out of a Notion row's properties by name.
 * Supports: title, rich_text, date, status, select. Returns null
 * if the field is absent or empty.
 */
export function readProp(
  row: NotionDatabasePage,
  name: string,
):
  | { kind: "text"; value: string }
  | { kind: "date"; start: string; end: string | null }
  | { kind: "status"; value: string }
  | null {
  const prop = row.properties[name] as Record<string, unknown> | undefined;
  if (!prop) return null;
  const type = prop.type as string | undefined;
  if (type === "title" && Array.isArray(prop.title)) {
    const text = (prop.title as Array<{ plain_text?: string }>)
      .map((t) => t.plain_text ?? "")
      .join("");
    return text ? { kind: "text", value: text } : null;
  }
  if (type === "rich_text" && Array.isArray(prop.rich_text)) {
    const text = (prop.rich_text as Array<{ plain_text?: string }>)
      .map((t) => t.plain_text ?? "")
      .join("");
    return text ? { kind: "text", value: text } : null;
  }
  if (type === "date") {
    const d = prop.date as { start?: string; end?: string | null } | null;
    if (!d || !d.start) return null;
    return { kind: "date", start: d.start, end: d.end ?? null };
  }
  if (type === "status") {
    const s = prop.status as { name?: string } | null;
    return s?.name ? { kind: "status", value: s.name } : null;
  }
  if (type === "select") {
    const s = prop.select as { name?: string } | null;
    return s?.name ? { kind: "status", value: s.name } : null;
  }
  return null;
}
