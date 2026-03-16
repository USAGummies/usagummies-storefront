/**
 * Abra Financial Document Processor
 *
 * Auto-processes financial brain entries into bookkeeping entries.
 * Pipeline: open_brain_entries (department=finance, financial_processed=false)
 *   → keyword filter for financial content
 *   → Claude extracts structured transaction data
 *   → Standard accrual accounting categorization
 *   → proposeAndMaybeExecute(record_transaction) — ≤$500 auto-executes
 *   → Mark financial_processed=true
 *
 * ACCOUNTING STANDARDS:
 * - Accrual basis (record when incurred, not when paid)
 * - COGS: raw materials, co-packer, inbound freight, production labor
 * - Selling expense: channel fees (Amazon/Shopify), customer shipping
 * - SG&A: rent, software, insurance, office
 * - Marketing: advertising, PPC, influencer, promotions
 * - Professional services: legal, accounting, consulting
 * - Capital expenditure: equipment > $2,500
 * - Contra-revenue: refunds, returns
 */

import { proposeAndMaybeExecute } from "@/lib/ops/abra-actions";
import {
  logAICost,
  extractClaudeUsage,
  getPreferredClaudeModel,
} from "@/lib/ops/abra-cost-tracker";

export type FinancialProcessResult = {
  processed: number;
  transactions: number;
  skipped: number;
  errors: number;
};

type BrainRow = {
  id: string;
  title: string | null;
  raw_text: string | null;
  summary_text: string | null;
  category: string | null;
  created_at: string;
};

const FINANCIAL_KEYWORDS =
  /\b(invoice|receipt|payment|paid|amount|vendor|bill|expense|revenue|cost|fee|freight|shipping|refund|subscription|rent|salary|insurance|equipment|\$\d)/i;

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials for financial processor");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }

  return json;
}

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return key;
}

const EXTRACTION_PROMPT = `You are a bookkeeper for USA Gummies, a CPG startup. Extract financial transaction data from the following document/note.

STANDARD CATEGORIES (use exactly one):
- "cogs" — Raw materials, ingredients, packaging, co-packer fees, production labor, inbound freight, QA costs
- "shipping_expense" — Outbound customer shipping, fulfillment fees
- "selling_expense" — Amazon referral/FBA fees, Shopify transaction fees, marketplace fees
- "sga" — Rent, software/SaaS, insurance, office supplies, utilities, general admin
- "marketing" — Advertising, PPC, influencer payments, promotions, trade shows
- "professional_services" — Legal, accounting, consulting, bookkeeping
- "capital_expenditure" — Equipment purchases > $2,500
- "contra_revenue" — Refunds, returns, chargebacks
- "income" — Revenue, sales proceeds, reimbursements received
- "transfer" — Internal transfers between accounts (not an expense)

TRANSACTION TYPES:
- "expense" — Money going out
- "income" — Money coming in
- "transfer" — Moving between accounts

DOCUMENT:
{DOCUMENT}

Extract ALL transactions found. Return ONLY a JSON array (no markdown, no code fences):
[
  {
    "amount": 123.45,
    "vendor": "Vendor Name or null",
    "date": "YYYY-MM-DD or null",
    "category": "one of the categories above",
    "type": "expense|income|transfer",
    "description": "Brief description of the transaction"
  }
]

If no clear financial transactions are found, return an empty array: []
Do NOT guess amounts. If the amount is unclear, skip that transaction.`;

type ExtractedTransaction = {
  amount: number;
  vendor: string | null;
  date: string | null;
  category: string;
  type: "expense" | "income" | "transfer";
  description: string;
};

const VALID_CATEGORIES = new Set([
  "cogs",
  "shipping_expense",
  "selling_expense",
  "sga",
  "marketing",
  "professional_services",
  "capital_expenditure",
  "contra_revenue",
  "income",
  "transfer",
]);

const VALID_TYPES = new Set(["expense", "income", "transfer"]);

function validateTransaction(raw: unknown): ExtractedTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const amount = Number(obj.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const category = String(obj.category || "").toLowerCase().trim();
  if (!VALID_CATEGORIES.has(category)) return null;

  const type = String(obj.type || "").toLowerCase().trim();
  if (!VALID_TYPES.has(type)) return null;

  const description = String(obj.description || "").trim();
  if (!description) return null;

  return {
    amount: Math.round(amount * 100) / 100,
    vendor: obj.vendor && typeof obj.vendor === "string" ? obj.vendor.trim() : null,
    date: obj.date && typeof obj.date === "string" ? obj.date.trim() : null,
    category,
    type: type as ExtractedTransaction["type"],
    description: description.slice(0, 300),
  };
}

async function processFinancialEntry(entry: BrainRow): Promise<{
  transactions: number;
  error?: string;
}> {
  const text = entry.raw_text || entry.summary_text || entry.title || "";

  // Keyword gate — skip if no financial content
  if (!FINANCIAL_KEYWORDS.test(text)) {
    return { transactions: 0 };
  }

  // Call Claude to extract transactions
  const model = await getPreferredClaudeModel("claude-sonnet-4-20250514");

  // Try loading versioned prompt from auto-research, fall back to hardcoded
  let promptTemplate = EXTRACTION_PROMPT;
  try {
    const { getActivePrompt } = await import("@/lib/ops/auto-research-runner");
    const versioned = await getActivePrompt("financial_processor");
    if (versioned?.prompt_text) {
      promptTemplate = versioned.prompt_text;
    }
  } catch {
    // Fallback to hardcoded — zero-downtime
  }

  const prompt = promptTemplate.replace(
    /\{\{?DOCUMENT\}?\}/g,
    text.slice(0, 6000),
  );

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getAnthropicKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => "");
    throw new Error(`Claude API failed (${anthropicRes.status}): ${errText.slice(0, 200)}`);
  }

  const payload = (await anthropicRes.json()) as Record<string, unknown>;

  // Log cost
  const usage = extractClaudeUsage(payload);
  if (usage) {
    void logAICost({
      model,
      provider: "anthropic",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      endpoint: "financial_processor",
      department: "finance",
    });
  }

  // Parse response
  const content = payload.content;
  const textBlock =
    Array.isArray(content) &&
    content[0] &&
    typeof content[0] === "object" &&
    "text" in (content[0] as Record<string, unknown>)
      ? String((content[0] as Record<string, unknown>).text)
      : "";

  let rawTransactions: unknown[];
  try {
    rawTransactions = JSON.parse(textBlock) as unknown[];
  } catch {
    const jsonMatch = textBlock.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      rawTransactions = JSON.parse(jsonMatch[0]) as unknown[];
    } else {
      return { transactions: 0, error: "Could not parse extraction response" };
    }
  }

  if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
    return { transactions: 0 };
  }

  // Validate and propose each transaction
  let count = 0;
  for (const raw of rawTransactions.slice(0, 5)) {
    const tx = validateTransaction(raw);
    if (!tx) continue;

    const sourceTitle = entry.title || "(untitled brain entry)";

    await proposeAndMaybeExecute({
      action_type: "record_transaction",
      title: `${tx.type === "income" ? "Income" : "Expense"}: ${tx.description.slice(0, 50)}`,
      description: `Auto-extracted from "${sourceTitle}". ${tx.vendor ? `Vendor: ${tx.vendor}.` : ""} Category: ${tx.category}.`,
      department: "finance",
      risk_level: tx.amount > 500 ? "medium" : "low",
      requires_approval: tx.amount > 500,
      confidence: 0.85,
      params: {
        type: tx.type,
        amount: tx.amount,
        description: tx.description,
        category: tx.category,
        vendor: tx.vendor,
        date: tx.date || new Date().toISOString().split("T")[0],
        source: `brain_entry:${entry.id}`,
        source_title: sourceTitle,
      },
    });

    count += 1;
  }

  return { transactions: count };
}

/**
 * Main entry point: process unprocessed financial brain entries.
 */
export async function processFinancialBrainEntries(params?: {
  limit?: number;
}): Promise<FinancialProcessResult> {
  const limit = params?.limit || 10;
  const result: FinancialProcessResult = {
    processed: 0,
    transactions: 0,
    skipped: 0,
    errors: 0,
  };

  // Fetch finance entries from last 2 days that haven't been processed
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const rows = (await sbFetch(
    `/rest/v1/open_brain_entries?department=eq.finance&or=(financial_processed.is.null,financial_processed.eq.false)&created_at=gte.${encodeURIComponent(twoDaysAgo)}&select=id,title,raw_text,summary_text,category,created_at&order=created_at.desc&limit=${limit}`,
  )) as BrainRow[];

  if (!Array.isArray(rows) || rows.length === 0) {
    return result;
  }

  for (const entry of rows) {
    result.processed += 1;

    try {
      const outcome = await processFinancialEntry(entry);

      if (outcome.transactions > 0) {
        result.transactions += outcome.transactions;
      } else {
        result.skipped += 1;
      }

      // Mark as processed regardless of outcome (to prevent re-processing)
      await sbFetch(
        `/rest/v1/open_brain_entries?id=eq.${encodeURIComponent(entry.id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ financial_processed: true }),
        },
      );
    } catch (error) {
      result.errors += 1;
      console.error(
        `[financial-processor] Error processing ${entry.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return result;
}
