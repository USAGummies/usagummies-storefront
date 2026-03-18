/**
 * Transaction Auto-Categorizer (B3)
 *
 * Two-stage classification:
 *   1. Pattern matching — fast, no API calls, covers ~80% of transactions
 *   2. LLM fallback — Claude Haiku for ambiguous transactions
 *
 * Account codes follow the USA Gummies chart of accounts.
 */

import {
  logAICost,
  extractClaudeUsage,
  getPreferredClaudeModel,
} from "@/lib/ops/abra-cost-tracker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransactionInput = {
  id?: string;
  description: string;
  amount: number;
  counterparty?: string;
  date: string;
};

export type CategorizationResult = {
  account_code: string;
  category: string;
  confidence: number;
};

export type BulkCategorizationResult = {
  id?: string;
  input: TransactionInput;
  result: CategorizationResult;
};

// ---------------------------------------------------------------------------
// Account code reference
// ---------------------------------------------------------------------------

const ACCOUNT_CODES: Record<string, string> = {
  "4100": "Shopify DTC Revenue",
  "4110": "Shopify Refund",
  "4200": "Amazon Revenue",
  "4210": "Amazon Refund",
  "4300": "Wholesale Revenue",
  "4400": "Faire Revenue",
  "5100": "Ingredients",
  "5200": "Co-Packing",
  "5300": "Packaging",
  "5400": "Freight-In",
  "5500": "Amazon Fees",
  "5020": "Shipping",
  "6100": "Marketing",
  "6200": "Software/SaaS",
  "6300": "Legal",
  "6400": "Insurance",
  "6500": "Bank Fees",
  "6600": "Shipping Expense",
  "6700": "Meals",
  "6800": "Miscellaneous",
};

// ---------------------------------------------------------------------------
// Pattern rules — ordered by specificity (most specific first)
// ---------------------------------------------------------------------------

type PatternRule = {
  test: (desc: string, amount: number, counterparty: string) => boolean;
  account_code: string;
  category: string;
  confidence: number;
};

const PATTERN_RULES: PatternRule[] = [
  // Amazon fees (must come before general Amazon match)
  {
    test: (d) => /amazon|amzn/i.test(d) && /fee|referral|fba|commission|fulfillment/i.test(d),
    account_code: "5500",
    category: "Amazon Fees",
    confidence: 0.95,
  },
  // Amazon refund
  {
    test: (d, a) => /amazon|amzn/i.test(d) && a < 0,
    account_code: "4210",
    category: "Amazon Refund",
    confidence: 0.90,
  },
  // Amazon revenue
  {
    test: (d) => /amazon|amzn/i.test(d),
    account_code: "4200",
    category: "Amazon Revenue",
    confidence: 0.90,
  },
  // Shopify subscription (SaaS, not revenue)
  {
    test: (d) => /shopify/i.test(d) && /subscription|monthly|plan|billing/i.test(d),
    account_code: "6200",
    category: "Software/SaaS",
    confidence: 0.90,
  },
  // Shopify refund
  {
    test: (d, a) => /shopify/i.test(d) && a < 0,
    account_code: "4110",
    category: "Shopify Refund",
    confidence: 0.90,
  },
  // Shopify revenue
  {
    test: (d) => /shopify/i.test(d),
    account_code: "4100",
    category: "Shopify DTC Revenue",
    confidence: 0.90,
  },
  // Faire
  {
    test: (d, _a, c) => /faire/i.test(d) || /faire/i.test(c),
    account_code: "4400",
    category: "Faire Revenue",
    confidence: 0.90,
  },
  // Manufacturing / COGS
  {
    test: (d, _a, c) =>
      /powers\s*confections|albanese|co-?pack|co\s+pack/i.test(d) ||
      /powers\s*confections|albanese/i.test(c),
    account_code: "5200",
    category: "Co-Packing / Manufacturing",
    confidence: 0.92,
  },
  // Shipping carriers
  {
    test: (d, _a, c) =>
      /\b(usps|ups|fedex|shipstation|dhl|easypost)\b/i.test(d) ||
      /\b(usps|ups|fedex|shipstation)\b/i.test(c),
    account_code: "5020",
    category: "Shipping",
    confidence: 0.90,
  },
  // Marketing / advertising
  {
    test: (d, _a, c) =>
      /google\s*ads|meta\s*(ads|platforms)?|facebook\s*(ads)?|tiktok\s*ads|instagram\s*ads|pinterest\s*ads/i.test(d) ||
      /google\s*ads|meta|facebook/i.test(c),
    account_code: "6100",
    category: "Marketing",
    confidence: 0.90,
  },
  // Software / SaaS
  {
    test: (d, _a, c) =>
      /vercel|heroku|aws|supabase|notion|slack|zapier|hubspot|mailchimp|klaviyo|recharge|gorgias|shipbob|canva|adobe|github|openai|anthropic/i.test(d) ||
      /vercel|notion|slack|zapier/i.test(c),
    account_code: "6200",
    category: "Software/SaaS",
    confidence: 0.85,
  },
  // Wholesale (generic)
  {
    test: (d) => /wholesale|distributor|bulk\s*order/i.test(d),
    account_code: "4300",
    category: "Wholesale Revenue",
    confidence: 0.80,
  },
  // Ingredients / raw materials
  {
    test: (d) => /ingredient|gelatin|sugar|citric\s*acid|flavor|pectin|corn\s*syrup/i.test(d),
    account_code: "5100",
    category: "Ingredients",
    confidence: 0.85,
  },
  // Packaging
  {
    test: (d) => /packaging|label|pouch|bag|box|carton|shrink\s*wrap/i.test(d),
    account_code: "5300",
    category: "Packaging",
    confidence: 0.85,
  },
  // Freight / inbound shipping
  {
    test: (d) => /freight|inbound\s*ship|pallet|ltl|truckload/i.test(d),
    account_code: "5400",
    category: "Freight-In",
    confidence: 0.85,
  },
  // Legal
  {
    test: (d, _a, c) => /legal|attorney|law\s*firm|trademark|patent/i.test(d) || /esq|law/i.test(c),
    account_code: "6300",
    category: "Legal",
    confidence: 0.85,
  },
  // Insurance
  {
    test: (d) => /insurance|liability|coverage|premium/i.test(d),
    account_code: "6400",
    category: "Insurance",
    confidence: 0.85,
  },
  // Bank fees
  {
    test: (d) => /bank\s*fee|wire\s*fee|ach\s*fee|overdraft|nsf/i.test(d),
    account_code: "6500",
    category: "Bank Fees",
    confidence: 0.90,
  },
];

// ---------------------------------------------------------------------------
// Pattern-based categorization
// ---------------------------------------------------------------------------

function categorizeByPattern(tx: TransactionInput): CategorizationResult | null {
  const desc = tx.description || "";
  const counterparty = tx.counterparty || "";

  for (const rule of PATTERN_RULES) {
    if (rule.test(desc, tx.amount, counterparty)) {
      return {
        account_code: rule.account_code,
        category: rule.category,
        confidence: rule.confidence,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// LLM-based categorization (Claude Haiku fallback)
// ---------------------------------------------------------------------------

const LLM_SYSTEM_PROMPT = `You are a bookkeeper for USA Gummies, a CPG gummy supplement startup. Categorize the following bank transaction into exactly one account code.

CHART OF ACCOUNTS:
4100 — Shopify DTC Revenue
4110 — Shopify Refund (negative amounts from Shopify)
4200 — Amazon Revenue
4210 — Amazon Refund (negative amounts from Amazon)
4300 — Wholesale Revenue
4400 — Faire Revenue
5100 — Ingredients (raw materials)
5200 — Co-Packing / Manufacturing
5300 — Packaging
5400 — Freight-In (inbound shipping to warehouse)
5500 — Amazon Fees (referral, FBA, etc.)
5020 — Shipping (outbound customer shipping)
6100 — Marketing (ads, influencers, promos)
6200 — Software/SaaS (subscriptions, tools)
6300 — Legal
6400 — Insurance
6500 — Bank Fees
6600 — Shipping Expense (non-COGS shipping)
6700 — Meals
6800 — Miscellaneous

Respond with ONLY a JSON object (no markdown, no code fences):
{"account_code": "XXXX", "category": "Category Name", "confidence": 0.XX}

The confidence should reflect how certain you are (0.5 to 1.0).`;

async function categorizeByLLM(tx: TransactionInput): Promise<CategorizationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { account_code: "6800", category: "Miscellaneous", confidence: 0.3 };
  }

  const model = await getPreferredClaudeModel("claude-3-5-haiku-latest");
  const userMessage = [
    `Description: ${tx.description}`,
    `Amount: $${tx.amount.toFixed(2)}`,
    tx.counterparty ? `Counterparty: ${tx.counterparty}` : null,
    `Date: ${tx.date}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 150,
        system: LLM_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[categorizer] Claude API error ${res.status}: ${errText.slice(0, 200)}`);
      return { account_code: "6800", category: "Miscellaneous", confidence: 0.3 };
    }

    const payload = (await res.json()) as Record<string, unknown>;

    // Log AI cost
    const usage = extractClaudeUsage(payload);
    if (usage) {
      logAICost({
        model,
        provider: "anthropic",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        endpoint: "transaction-categorizer",
      }).catch(() => {});
    }

    // Parse response
    const content = payload.content;
    if (!Array.isArray(content) || content.length === 0) {
      return { account_code: "6800", category: "Miscellaneous", confidence: 0.3 };
    }
    const textBlock = content[0] as { text?: string };
    const rawText = (textBlock.text || "").trim();

    // Try to parse JSON from the response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { account_code: "6800", category: "Miscellaneous", confidence: 0.3 };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const accountCode = String(parsed.account_code || "6800").trim();
    const category = String(parsed.category || ACCOUNT_CODES[accountCode] || "Miscellaneous").trim();
    const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));

    // Validate that the account code is in our chart
    if (!ACCOUNT_CODES[accountCode]) {
      return { account_code: "6800", category: "Miscellaneous", confidence: 0.3 };
    }

    return { account_code: accountCode, category, confidence };
  } catch (err) {
    console.error("[categorizer] LLM fallback error:", err instanceof Error ? err.message : err);
    return { account_code: "6800", category: "Miscellaneous", confidence: 0.3 };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Categorize a single transaction. Uses pattern matching first; falls back
 * to Claude Haiku if confidence is below 0.8.
 */
export async function categorizeTransaction(
  tx: TransactionInput,
): Promise<CategorizationResult> {
  const patternResult = categorizeByPattern(tx);
  if (patternResult && patternResult.confidence >= 0.8) {
    return patternResult;
  }

  // Fall back to LLM
  const llmResult = await categorizeByLLM(tx);

  // If pattern had a result but low confidence, pick the higher-confidence one
  if (patternResult) {
    return patternResult.confidence >= llmResult.confidence ? patternResult : llmResult;
  }

  return llmResult;
}

/**
 * Batch-categorize an array of transactions.
 * Pattern matches run synchronously; LLM calls are batched with concurrency control.
 */
export async function bulkCategorize(
  txs: TransactionInput[],
): Promise<BulkCategorizationResult[]> {
  const results: BulkCategorizationResult[] = [];
  const needsLLM: Array<{ index: number; tx: TransactionInput }> = [];

  // First pass: pattern matching
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const patternResult = categorizeByPattern(tx);
    if (patternResult && patternResult.confidence >= 0.8) {
      results[i] = { id: tx.id, input: tx, result: patternResult };
    } else {
      needsLLM.push({ index: i, tx });
      // Placeholder — will be replaced
      results[i] = {
        id: tx.id,
        input: tx,
        result: patternResult || { account_code: "6800", category: "Miscellaneous", confidence: 0 },
      };
    }
  }

  // Second pass: LLM for unmatched (concurrency = 5)
  if (needsLLM.length > 0) {
    const CONCURRENCY = 5;
    for (let batch = 0; batch < needsLLM.length; batch += CONCURRENCY) {
      const chunk = needsLLM.slice(batch, batch + CONCURRENCY);
      const llmResults = await Promise.all(
        chunk.map(async ({ index, tx }) => {
          const llmResult = await categorizeByLLM(tx);
          const existing = results[index].result;
          // Pick whichever has higher confidence
          const best = existing.confidence >= llmResult.confidence ? existing : llmResult;
          return { index, result: best };
        }),
      );
      for (const { index, result } of llmResults) {
        results[index] = { id: results[index].id, input: results[index].input, result };
      }
    }
  }

  return results;
}
