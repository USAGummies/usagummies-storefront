/**
 * Notion API client — raw fetch wrapper for all Notion operations.
 *
 * Uses the same proven pattern as src/lib/auth/notion-user-adapter.ts
 * (raw fetch, no @notionhq/client SDK — keeps bundle lean).
 *
 * Usage:
 *   import { queryDatabase, createPage, DB, NotionProp } from "@/lib/notion/client";
 *   const rows = await queryDatabase(DB.DAILY_PERFORMANCE, filter);
 *   await createPage(DB.DAILY_PERFORMANCE, { "Name": NotionProp.title("2026-02-25"), ... });
 */

import "server-only";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NOTION_API_KEY = () => process.env.NOTION_API_KEY || "";
const NOTION_VERSION = "2022-06-28";

/** All known Notion database IDs (env override → hardcoded fallback) */
export const DB = {
  DAILY_PERFORMANCE:
    process.env.NOTION_DAILY_PERF_DB_ID ||
    "2f31cfad04b744e3b16da4edc9675502",
  FLEET_OPS_LOG:
    process.env.NOTION_FLEET_OPS_DB_ID ||
    "30d4c0c4-2c2e-81b0-914e-e534e56e2351",
  INVENTORY:
    process.env.NOTION_INVENTORY_DB_ID || "d598e72e09974194bfe3624ee6e0117e",
  SKU_REGISTRY:
    process.env.NOTION_SKU_DB_ID || "8173583d402145fb8d87ad74c0241f00",
  PLATFORM_USERS:
    process.env.NOTION_PLATFORM_USERS_DB_ID ||
    "f1f7500b35d34908addeba4b94b21c6e",
  CASH_TRANSACTIONS:
    process.env.NOTION_CASH_TX_DB_ID || "6325d16870024b83876b9e591b3d2d9c",
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_API_KEY()}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/** Convert 32-char hex to dashed UUID if needed */
export function toNotionId(raw: string): string {
  const clean = raw.replace(/-/g, "");
  if (clean.length !== 32) return raw;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Property extractors (reading from Notion)
// ---------------------------------------------------------------------------

/** Extract plain text from any Notion property */
export function extractText(prop: unknown): string {
  const p = prop as Record<string, unknown> | undefined;
  if (!p) return "";

  // title type
  if (p.type === "title" && Array.isArray(p.title)) {
    return (p.title as { plain_text?: string }[])
      .map((t) => t.plain_text || "")
      .join("");
  }
  // rich_text type
  if (p.type === "rich_text" && Array.isArray(p.rich_text)) {
    return (p.rich_text as { plain_text?: string }[])
      .map((t) => t.plain_text || "")
      .join("");
  }
  // email type
  if (p.type === "email") return (p.email as string) || "";
  // url type
  if (p.type === "url") return (p.url as string) || "";
  // select type
  if (p.type === "select")
    return ((p.select as { name?: string }) || {}).name || "";
  // multi_select type
  if (p.type === "multi_select" && Array.isArray(p.multi_select)) {
    return (p.multi_select as { name: string }[])
      .map((s) => s.name)
      .join(", ");
  }
  // checkbox type
  if (p.type === "checkbox") return p.checkbox ? "true" : "false";
  // number type
  if (p.type === "number")
    return p.number != null ? String(p.number) : "";
  // date type
  if (p.type === "date")
    return ((p.date as { start?: string }) || {}).start || "";

  return "";
}

/** Extract numeric value from a Notion number property */
export function extractNumber(prop: unknown): number {
  const p = prop as { type?: string; number?: number } | undefined;
  if (!p || p.type !== "number") return 0;
  return p.number ?? 0;
}

/** Extract date string from a Notion date property */
export function extractDate(prop: unknown): string {
  const p = prop as { type?: string; date?: { start?: string } } | undefined;
  if (!p || p.type !== "date") return "";
  return p.date?.start || "";
}

// ---------------------------------------------------------------------------
// Property builders (writing to Notion)
// ---------------------------------------------------------------------------

export const NotionProp = {
  title: (text: string) => ({ title: [{ text: { content: text } }] }),
  richText: (text: string) => ({
    rich_text: [{ text: { content: text } }],
  }),
  number: (n: number) => ({ number: n }),
  date: (iso: string) => ({ date: { start: iso } }),
  select: (name: string) => ({ select: { name } }),
  checkbox: (val: boolean) => ({ checkbox: val }),
  url: (url: string) => ({ url }),
  email: (email: string) => ({ email }),
};

// ---------------------------------------------------------------------------
// Core CRUD operations
// ---------------------------------------------------------------------------

/**
 * Query a Notion database with optional filter and sorts.
 * Returns the `results` array (page objects) or null on failure.
 */
export async function queryDatabase(
  dbId: string,
  filter?: Record<string, unknown>,
  sorts?: { property: string; direction: "ascending" | "descending" }[],
  pageSize = 100,
): Promise<Record<string, unknown>[] | null> {
  if (!NOTION_API_KEY()) {
    console.error("[notion] NOTION_API_KEY not set");
    return null;
  }

  try {
    const body: Record<string, unknown> = { page_size: pageSize };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;

    const res = await fetch(
      `https://api.notion.com/v1/databases/${toNotionId(dbId)}/query`,
      {
        method: "POST",
        headers: notionHeaders(),
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );

    if (!res.ok) {
      console.error(
        `[notion] Query failed for ${dbId}: ${res.status} ${res.statusText}`,
      );
      return null;
    }

    const data = await res.json();
    return (data.results as Record<string, unknown>[]) || [];
  } catch (err) {
    console.error("[notion] Query error:", err);
    return null;
  }
}

/**
 * Create a page (row) in a Notion database.
 * Returns the created page object or null on failure.
 */
export async function createPage(
  dbId: string,
  properties: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!NOTION_API_KEY()) {
    console.error("[notion] NOTION_API_KEY not set");
    return null;
  }

  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify({
        parent: { database_id: toNotionId(dbId) },
        properties,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(
        `[notion] Create page failed: ${res.status} ${res.statusText} — ${text}`,
      );
      return null;
    }

    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[notion] Create page error:", err);
    return null;
  }
}

/**
 * Update properties on an existing Notion page.
 * Returns the updated page or null on failure.
 */
export async function updatePage(
  pageId: string,
  properties: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!NOTION_API_KEY()) {
    console.error("[notion] NOTION_API_KEY not set");
    return null;
  }

  try {
    const res = await fetch(
      `https://api.notion.com/v1/pages/${toNotionId(pageId)}`,
      {
        method: "PATCH",
        headers: notionHeaders(),
        body: JSON.stringify({ properties }),
      },
    );

    if (!res.ok) {
      console.error(
        `[notion] Update page failed: ${res.status} ${res.statusText}`,
      );
      return null;
    }

    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[notion] Update page error:", err);
    return null;
  }
}
