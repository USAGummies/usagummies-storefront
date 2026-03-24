/**
 * POST /api/ops/finance/upload — CSV upload for Bank of America bank transactions.
 *
 * Parses Bank of America CSV export (Date, Name, Amount), auto-categorizes,
 * deduplicates against existing Notion records, and writes to the
 * Cash & Transactions database.
 *
 * Protected by middleware (requires JWT session with admin/investor role).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createPage,
  DB,
  NotionProp,
  queryDatabase,
  extractText,
  extractDate,
} from "@/lib/notion/client";
import { writeState } from "@/lib/ops/state";
import type { CashTransaction, CashPosition } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// CSV parser for Bank of America export format
// ---------------------------------------------------------------------------

function categorize(
  description: string,
  amount: number,
): { category: CashTransaction["category"]; channel: CashTransaction["channel"] } {
  const desc = description.toLowerCase();

  if (desc.includes("shopify"))
    return { category: amount > 0 ? "Income" : "Refund", channel: "Shopify" };
  if (desc.includes("amazon"))
    return { category: amount > 0 ? "Income" : "Refund", channel: "Amazon" };
  if (desc.includes("transfer") || desc.includes("ach"))
    return { category: "Transfer", channel: "Found Transfer" };
  if (desc.includes("wholesale") || desc.includes("faire"))
    return {
      category: amount > 0 ? "Income" : "Expense",
      channel: "Wholesale",
    };

  return { category: amount > 0 ? "Income" : "Expense", channel: "Other" };
}

function parseFoundCSV(text: string): CashTransaction[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const transactions: CashTransaction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle CSV — split on commas (basic; Found exports are simple)
    const parts = line.split(",");
    if (parts.length < 3) continue;

    const dateRaw = parts[0].trim(); // MM/DD/YYYY
    const description = parts[1].trim();
    const amountRaw = parts[2].trim().replace(/[^0-9.-]/g, "");
    const amount = parseFloat(amountRaw);

    if (isNaN(amount)) continue;

    // Convert MM/DD/YYYY → YYYY-MM-DD
    const dateParts = dateRaw.split("/");
    if (dateParts.length !== 3) continue;
    const [month, day, year] = dateParts;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

    const { category, channel } = categorize(description, amount);
    transactions.push({
      date,
      description,
      amount,
      category,
      channel,
      source: "CSV Upload",
    });
  }

  return transactions.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    if (!DB.CASH_TRANSACTIONS) {
      return NextResponse.json(
        { error: "NOTION_CASH_TX_DB_ID not configured" },
        { status: 500 },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 },
      );
    }

    const text = await file.text();
    const transactions = parseFoundCSV(text);

    if (transactions.length === 0) {
      return NextResponse.json(
        { error: "No valid transactions found in CSV" },
        { status: 400 },
      );
    }

    // Check for existing transactions to avoid duplicates
    const dateRange = {
      start: transactions[0].date,
      end: transactions[transactions.length - 1].date,
    };

    const existing = await queryDatabase(DB.CASH_TRANSACTIONS, {
      and: [
        { property: "Date", date: { on_or_after: dateRange.start } },
        { property: "Date", date: { on_or_before: dateRange.end } },
        { property: "Source", select: { equals: "CSV Upload" } },
      ],
    });

    // Build dedup set of date|description keys
    const existingKeys = new Set(
      (existing || []).map((page) => {
        const props = (page.properties || {}) as Record<string, unknown>;
        const date = extractDate(props["Date"]);
        const desc = extractText(props["Description"]);
        return `${date}|${desc}`;
      }),
    );

    let written = 0;
    let skipped = 0;
    let runningBalance = 0;

    for (const tx of transactions) {
      const key = `${tx.date}|${tx.description}`;
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      runningBalance += tx.amount;

      await createPage(DB.CASH_TRANSACTIONS, {
        Name: NotionProp.title(`${tx.date} ${tx.description}`),
        Date: NotionProp.date(tx.date),
        Description: NotionProp.richText(tx.description),
        Amount: NotionProp.number(tx.amount),
        Category: NotionProp.select(tx.category),
        Channel: NotionProp.select(tx.channel),
        "Balance After": NotionProp.number(
          Math.round(runningBalance * 100) / 100,
        ),
        Source: NotionProp.select("CSV Upload"),
      });

      written++;
    }

    // Update cached cash position
    const income = transactions
      .filter((t) => t.amount > 0)
      .reduce((s, t) => s + t.amount, 0);
    const expenses = transactions
      .filter((t) => t.amount < 0)
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    const cashPosition: CashPosition = {
      balance: Math.round(runningBalance * 100) / 100,
      lastUpdated: new Date().toISOString(),
      recentTransactions: transactions.slice(-10),
      monthlyIncome: Math.round(income * 100) / 100,
      monthlyExpenses: Math.round(expenses * 100) / 100,
      monthlyNet: Math.round((income - expenses) * 100) / 100,
    };

    await writeState("cash-position", cashPosition);

    return NextResponse.json({
      ok: true,
      written,
      skipped,
      total: transactions.length,
      cashPosition,
    });
  } catch (err) {
    console.error("[finance/upload] CSV upload failed:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 },
    );
  }
}
