/**
 * AP/AR Aging Dashboard — tracks accounts payable and receivable.
 *
 * Data sources (layered, best-effort):
 *   1. Supabase `invoices` table (primary, once populated)
 *   2. Notion `cash_transactions` (payables by known vendors)
 *   3. Notion B2B pipeline (receivables with "invoice sent" status)
 *
 * Cached via KV state with 15-min TTL (same pattern as supply-chain).
 */

import "server-only";

import { DB, extractDate, extractNumber, extractText } from "@/lib/notion/client";
import { queryNotionDatabase } from "@/lib/ops/abra-notion-write";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export type PayableItem = {
  id: string;
  vendor: string;
  description: string;
  amount: number;
  dueDate: string;
  invoiceDate: string;
  status: "pending" | "paid" | "overdue";
  agingBucket: AgingBucket;
  daysOutstanding: number;
};

export type ReceivableItem = {
  id: string;
  customer: string;
  description: string;
  amount: number;
  invoiceDate: string;
  dueDate: string;
  status: "pending" | "paid" | "overdue";
  agingBucket: AgingBucket;
  daysOutstanding: number;
};

type BucketTotals = Record<AgingBucket, number>;

export type AgingSummary = {
  payables: {
    items: PayableItem[];
    total: number;
    byBucket: BucketTotals;
    overdueTotal: number;
  };
  receivables: {
    items: ReceivableItem[];
    total: number;
    byBucket: BucketTotals;
    overdueTotal: number;
  };
  netPosition: number; // receivables.total - payables.total
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/** Known vendor names — used to identify payables in cash_transactions */
const KNOWN_VENDORS = [
  "Powers",
  "Powers Confections",
  "Albanese",
  "Albanese Confectionery",
  "Vercel",
  "Shopify",
  "Amazon",
  "Google",
  "Meta",
  "Faire",
  "ShipStation",
  "QuickBooks",
  "Notion",
  "Upstash",
  "GoDaddy",
  "Namecheap",
];

const EMPTY_BUCKETS: BucketTotals = {
  current: 0,
  "1-30": 0,
  "31-60": 0,
  "61-90": 0,
  "90+": 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function daysBetween(dateStr: string, refDate: Date): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return 0;
  return Math.floor((refDate.getTime() - d.getTime()) / 86_400_000);
}

/**
 * Classify an item into an aging bucket based on days past due.
 * Negative days means not yet due (current).
 */
export function classifyAgingBucket(dueDate: string): AgingBucket {
  const now = new Date();
  const days = daysBetween(dueDate, now);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function deriveStatus(
  dueDate: string,
  paidDate?: string | null,
): "pending" | "paid" | "overdue" {
  if (paidDate) return "paid";
  const days = daysBetween(dueDate, new Date());
  return days > 0 ? "overdue" : "pending";
}

// ---------------------------------------------------------------------------
// Notion property readers (same pattern as abra-financial-statements)
// ---------------------------------------------------------------------------

type NotionPage = Record<string, unknown>;

function getProps(page: NotionPage): Record<string, unknown> {
  const props = page.properties;
  return props && typeof props === "object"
    ? (props as Record<string, unknown>)
    : {};
}

function readText(props: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const v = props[name];
    const text = extractText(v).trim();
    if (text) return text;
  }
  return "";
}

function readNumber(props: Record<string, unknown>, names: string[]): number {
  for (const name of names) {
    const v = props[name];
    const n = extractNumber(v);
    if (n) return n;
    const t = extractText(v).replace(/[$,]/g, "").trim();
    if (!t) continue;
    const parsed = Number(t);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function readDateValue(
  props: Record<string, unknown>,
  names: string[],
): string {
  for (const name of names) {
    const v = props[name];
    const date = extractDate(v).trim();
    if (date) return date.slice(0, 10);
    const text = extractText(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Supabase invoice fetching
// ---------------------------------------------------------------------------

async function fetchSupabaseInvoices(): Promise<{
  payables: PayableItem[];
  receivables: ReceivableItem[];
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return { payables: [], receivables: [] };
  }

  try {
    const res = await fetch(
      `${url}/rest/v1/invoices?status=neq.cancelled&order=due_date.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!res.ok) return { payables: [], receivables: [] };

    const rows = (await res.json()) as Array<{
      id: string;
      type: string;
      counterparty: string;
      description: string | null;
      amount: number;
      invoice_date: string;
      due_date: string;
      paid_date: string | null;
      status: string;
      reference: string | null;
      notes: string | null;
    }>;

    const payables: PayableItem[] = [];
    const receivables: ReceivableItem[] = [];

    for (const row of rows) {
      const bucket = classifyAgingBucket(row.due_date);
      const status = deriveStatus(row.due_date, row.paid_date);
      const daysOut = Math.max(0, daysBetween(row.due_date, new Date()));

      if (row.type === "payable") {
        payables.push({
          id: row.id,
          vendor: row.counterparty,
          description: row.description || "",
          amount: round2(Math.abs(row.amount)),
          dueDate: row.due_date,
          invoiceDate: row.invoice_date,
          status,
          agingBucket: bucket,
          daysOutstanding: daysOut,
        });
      } else if (row.type === "receivable") {
        receivables.push({
          id: row.id,
          customer: row.counterparty,
          description: row.description || "",
          amount: round2(Math.abs(row.amount)),
          invoiceDate: row.invoice_date,
          dueDate: row.due_date,
          status,
          agingBucket: bucket,
          daysOutstanding: daysOut,
        });
      }
    }

    return { payables, receivables };
  } catch (err) {
    console.error("[ap-ar] Supabase fetch failed:", err);
    return { payables: [], receivables: [] };
  }
}

// ---------------------------------------------------------------------------
// Notion cash_transactions → payables (negative amounts to known vendors)
// ---------------------------------------------------------------------------

async function fetchNotionPayables(): Promise<PayableItem[]> {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const cutoff = threeMonthsAgo.toISOString().slice(0, 10);

  const pages = await queryNotionDatabase({
    database_id: DB.CASH_TRANSACTIONS,
    filter: {
      and: [{ property: "Date", date: { on_or_after: cutoff } }],
    },
    sorts: [{ property: "Date", direction: "descending" }],
    page_size: 100,
  });

  const items: PayableItem[] = [];
  const vendorSet = new Set(KNOWN_VENDORS.map((v) => v.toLowerCase()));

  for (const page of pages) {
    const props = getProps(page);
    const amount = readNumber(props, ["Amount", "Net Amount", "Total", "Value"]);
    // Only negative amounts (outflows) are payables
    if (amount >= 0) continue;

    const vendor =
      readText(props, ["Vendor", "Payee", "Merchant"]) ||
      readText(props, ["Name", "Description", "Transaction", "Memo"]);
    if (!vendor) continue;

    // Check if vendor matches any known vendor
    const vendorLower = vendor.toLowerCase();
    const isKnown = [...vendorSet].some((kv) => vendorLower.includes(kv));
    if (!isKnown) continue;

    const dateStr =
      readDateValue(props, ["Date", "Transaction Date"]) ||
      new Date().toISOString().slice(0, 10);
    const description = readText(props, [
      "Name",
      "Description",
      "Transaction",
      "Memo",
    ]);

    // Assume Net 30 from transaction date
    const dueDate = new Date(`${dateStr}T00:00:00Z`);
    dueDate.setDate(dueDate.getDate() + 30);
    const dueDateStr = dueDate.toISOString().slice(0, 10);

    const bucket = classifyAgingBucket(dueDateStr);
    const status = deriveStatus(dueDateStr);
    const daysOut = Math.max(0, daysBetween(dueDateStr, new Date()));

    items.push({
      id: typeof page.id === "string" ? page.id : `notion-${Date.now()}`,
      vendor,
      description,
      amount: round2(Math.abs(amount)),
      dueDate: dueDateStr,
      invoiceDate: dateStr,
      status,
      agingBucket: bucket,
      daysOutstanding: daysOut,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Notion B2B pipeline → receivables (deals with "invoice sent" status)
// ---------------------------------------------------------------------------

async function fetchNotionReceivables(): Promise<ReceivableItem[]> {
  const b2bDbId =
    process.env.NOTION_B2B_PROSPECTS_DB ||
    process.env.NOTION_DB_B2B_PROSPECTS ||
    "";
  if (!b2bDbId) return [];

  try {
    const pages = await queryNotionDatabase({
      database_id: b2bDbId,
      filter: {
        or: [
          { property: "Status", select: { equals: "Invoice Sent" } },
          { property: "Status", select: { equals: "invoice sent" } },
          { property: "Status", select: { equals: "Invoiced" } },
          { property: "Stage", select: { equals: "Invoice Sent" } },
        ],
      },
      page_size: 100,
    });

    const items: ReceivableItem[] = [];

    for (const page of pages) {
      const props = getProps(page);
      const customer =
        readText(props, ["Company", "Name", "Customer", "Account"]) ||
        "Unknown";
      const amount = readNumber(props, [
        "Deal Value",
        "Amount",
        "Invoice Amount",
        "Value",
        "Revenue",
      ]);
      if (amount <= 0) continue;

      const invoiceDate =
        readDateValue(props, [
          "Invoice Date",
          "Date",
          "Created",
          "Last Updated",
        ]) || new Date().toISOString().slice(0, 10);

      // Assume Net 30
      const dueDate = new Date(`${invoiceDate}T00:00:00Z`);
      dueDate.setDate(dueDate.getDate() + 30);
      const dueDateStr = dueDate.toISOString().slice(0, 10);

      const description = readText(props, [
        "Description",
        "Notes",
        "Deal Name",
        "Product",
      ]);

      const bucket = classifyAgingBucket(dueDateStr);
      const status = deriveStatus(dueDateStr);
      const daysOut = Math.max(0, daysBetween(dueDateStr, new Date()));

      items.push({
        id: typeof page.id === "string" ? page.id : `notion-ar-${Date.now()}`,
        customer,
        description: description || `B2B order — ${customer}`,
        amount: round2(amount),
        invoiceDate,
        dueDate: dueDateStr,
        status,
        agingBucket: bucket,
        daysOutstanding: daysOut,
      });
    }

    return items;
  } catch (err) {
    console.error("[ap-ar] Notion B2B receivables fetch failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function buildBucketTotals(
  items: Array<{ amount: number; agingBucket: AgingBucket }>,
): BucketTotals {
  const buckets: BucketTotals = { ...EMPTY_BUCKETS };
  for (const item of items) {
    buckets[item.agingBucket] = round2(
      (buckets[item.agingBucket] || 0) + item.amount,
    );
  }
  return buckets;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function getAgingSummary(): Promise<AgingSummary> {
  // Check cache first
  const cached = await readState<CacheEnvelope<AgingSummary> | null>(
    "ap-ar-cache",
    null,
  );
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.data;
  }

  // Fetch from all sources in parallel
  const [supabaseData, notionPayables, notionReceivables] = await Promise.all([
    fetchSupabaseInvoices(),
    fetchNotionPayables(),
    fetchNotionReceivables(),
  ]);

  // Merge and dedupe — Supabase takes priority
  const allPayables = dedupeById([
    ...supabaseData.payables,
    ...notionPayables,
  ]);
  const allReceivables = dedupeById([
    ...supabaseData.receivables,
    ...notionReceivables,
  ]);

  // Filter out paid items for totals (but keep them in the list for history)
  const openPayables = allPayables.filter((p) => p.status !== "paid");
  const openReceivables = allReceivables.filter((r) => r.status !== "paid");

  const payablesTotal = round2(
    openPayables.reduce((sum, p) => sum + p.amount, 0),
  );
  const receivablesTotal = round2(
    openReceivables.reduce((sum, r) => sum + r.amount, 0),
  );

  const payablesBuckets = buildBucketTotals(openPayables);
  const receivablesBuckets = buildBucketTotals(openReceivables);

  const payablesOverdue = round2(
    openPayables
      .filter((p) => p.status === "overdue")
      .reduce((sum, p) => sum + p.amount, 0),
  );
  const receivablesOverdue = round2(
    openReceivables
      .filter((r) => r.status === "overdue")
      .reduce((sum, r) => sum + r.amount, 0),
  );

  const summary: AgingSummary = {
    payables: {
      items: allPayables,
      total: payablesTotal,
      byBucket: payablesBuckets,
      overdueTotal: payablesOverdue,
    },
    receivables: {
      items: allReceivables,
      total: receivablesTotal,
      byBucket: receivablesBuckets,
      overdueTotal: receivablesOverdue,
    },
    netPosition: round2(receivablesTotal - payablesTotal),
    generatedAt: new Date().toISOString(),
  };

  // Cache result
  await writeState("ap-ar-cache", {
    data: summary,
    cachedAt: Date.now(),
  });

  return summary;
}
