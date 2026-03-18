import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import {
  bulkCategorize,
  type TransactionInput,
} from "@/lib/ops/transaction-categorizer";
import { queryNotionDatabase } from "@/lib/ops/abra-notion-write";
import { DB } from "@/lib/notion/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CategorizeRequest = {
  transactions?: Array<{
    id: string;
    description: string;
    amount: number;
    counterparty?: string;
    date: string;
  }>;
  apply?: boolean;
};

/**
 * POST /api/ops/abra/categorize-transactions
 *
 * Accepts a list of transactions and returns categorization results.
 * If {apply: true} and all results have confidence > 0.9, updates Notion.
 */
export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as CategorizeRequest;

    // If no transactions provided, fetch uncategorized from Notion
    let transactions: TransactionInput[] = [];

    if (body.transactions && body.transactions.length > 0) {
      transactions = body.transactions.map((tx) => ({
        id: tx.id,
        description: tx.description,
        amount: tx.amount,
        counterparty: tx.counterparty,
        date: tx.date,
      }));
    } else {
      // Fetch uncategorized transactions from Notion
      const pages = await queryNotionDatabase({
        database_id: DB.CASH_TRANSACTIONS,
        filter: {
          or: [
            { property: "Account Code", rich_text: { is_empty: true } },
            { property: "GL Code", rich_text: { is_empty: true } },
          ],
        },
        sorts: [{ property: "Date", direction: "descending" }],
        page_size: 50,
      });

      transactions = pages.map((page) => {
        const props = (page as Record<string, unknown>).properties as Record<string, unknown> | undefined;
        return {
          id: typeof (page as Record<string, unknown>).id === "string" ? (page as Record<string, unknown>).id as string : "",
          description: extractText(props, ["Name", "Description", "Transaction", "Memo"]),
          amount: extractNumber(props, ["Amount", "Net Amount", "Total", "Value"]),
          counterparty: extractText(props, ["Vendor", "Payee", "Merchant"]) || undefined,
          date: extractDate(props, ["Date", "Transaction Date"]),
        };
      });
    }

    if (transactions.length === 0) {
      return NextResponse.json({
        message: "No uncategorized transactions found",
        categorized: 0,
        applied: 0,
      });
    }

    const results = await bulkCategorize(transactions);

    const highConfidence = results.filter((r) => r.result.confidence > 0.9);
    const lowConfidence = results.filter((r) => r.result.confidence <= 0.9);
    let applied = 0;

    // Auto-apply if requested and all high-confidence
    if (body.apply && highConfidence.length > 0) {
      applied = await applyCategories(highConfidence);
    }

    return NextResponse.json({
      total: results.length,
      highConfidence: highConfidence.length,
      lowConfidence: lowConfidence.length,
      applied,
      results: results.map((r) => ({
        id: r.id,
        description: r.input.description,
        amount: r.input.amount,
        ...r.result,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to categorize transactions",
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers — extract Notion property values (same pattern as abra-financial-statements)
// ---------------------------------------------------------------------------

function extractText(
  props: Record<string, unknown> | undefined,
  names: string[],
): string {
  if (!props) return "";
  for (const name of names) {
    const prop = props[name] as Record<string, unknown> | undefined;
    if (!prop) continue;

    // title type
    if (Array.isArray(prop.title)) {
      const text = (prop.title as Array<{ plain_text?: string }>)
        .map((t) => t.plain_text || "")
        .join("")
        .trim();
      if (text) return text;
    }
    // rich_text type
    if (Array.isArray(prop.rich_text)) {
      const text = (prop.rich_text as Array<{ plain_text?: string }>)
        .map((t) => t.plain_text || "")
        .join("")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

function extractNumber(
  props: Record<string, unknown> | undefined,
  names: string[],
): number {
  if (!props) return 0;
  for (const name of names) {
    const prop = props[name] as Record<string, unknown> | undefined;
    if (!prop) continue;
    if (typeof prop.number === "number") return prop.number;
    // Try from rich_text
    if (Array.isArray(prop.rich_text)) {
      const text = (prop.rich_text as Array<{ plain_text?: string }>)
        .map((t) => t.plain_text || "")
        .join("")
        .replace(/[$,]/g, "")
        .trim();
      const parsed = Number(text);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function extractDate(
  props: Record<string, unknown> | undefined,
  names: string[],
): string {
  if (!props) return "";
  for (const name of names) {
    const prop = props[name] as Record<string, unknown> | undefined;
    if (!prop) continue;
    if (prop.date && typeof prop.date === "object") {
      const d = prop.date as { start?: string };
      if (d.start) return d.start.slice(0, 10);
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Apply categories to Notion pages
// ---------------------------------------------------------------------------

async function applyCategories(
  results: Array<{ id?: string; result: { account_code: string; category: string } }>,
): Promise<number> {
  const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  if (!notionToken) return 0;

  let applied = 0;

  for (const item of results) {
    if (!item.id) continue;
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${item.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            "Account Code": {
              rich_text: [{ text: { content: item.result.account_code } }],
            },
            Category: {
              rich_text: [{ text: { content: item.result.category } }],
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) applied++;
    } catch (err) {
      console.error(
        `[categorizer] Failed to update page ${item.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return applied;
}
