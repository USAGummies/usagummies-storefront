/**
 * Bank Transaction Auto-Tagger
 *
 * Every Plaid transaction gets auto-tagged with:
 *  - Vendor match (pattern → known vendor)
 *  - Category (from COA rules)
 *  - GL Account ID
 *  - Confidence score
 *
 * High-confidence tags get pre-applied in QBO.
 * Low-confidence tags get queued for Rene's review.
 */

import { notifyDaily } from "@/lib/ops/notify";

export type TaggedTransaction = {
  plaidId: string;
  date: string;
  description: string;
  amount: number;
  vendor: string | null;
  category: string | null;
  glAccountId: number | null;
  glAccountName: string | null;
  confidence: number;
  isInvestorTransfer: boolean;
  rule: string;
};

// Pattern-based vendor + category matching rules
const TAGGING_RULES: Array<{
  pattern: RegExp;
  vendor: string;
  category: string;
  glAccountId: number;
  glAccountName: string;
  confidence: number;
}> = [
  // Shipping
  { pattern: /pirate\s*ship/i, vendor: "Pirate Ship", category: "Shipping Expense", glAccountId: 5700, glAccountName: "DTC Fulfillment / Shipping", confidence: 0.95 },
  // Software & SaaS
  { pattern: /shopify/i, vendor: "Shopify", category: "Software", glAccountId: 6100, glAccountName: "Software & SaaS", confidence: 0.95 },
  { pattern: /anthropic/i, vendor: "Anthropic", category: "Software", glAccountId: 6100, glAccountName: "AI Operations (Anthropic)", confidence: 0.95 },
  { pattern: /slack/i, vendor: "Slack", category: "Software", glAccountId: 6100, glAccountName: "Software & SaaS", confidence: 0.90 },
  { pattern: /vercel/i, vendor: "Vercel", category: "Software", glAccountId: 6100, glAccountName: "Software & SaaS", confidence: 0.90 },
  { pattern: /github/i, vendor: "GitHub", category: "Software", glAccountId: 6100, glAccountName: "Software & SaaS", confidence: 0.90 },
  { pattern: /google|gcp|cloud/i, vendor: "Google", category: "Software", glAccountId: 6100, glAccountName: "Software & SaaS", confidence: 0.80 },
  // Vendors
  { pattern: /powers|powers\s*confection/i, vendor: "Powers Confections", category: "COGS - Co-Packing", glAccountId: 5300, glAccountName: "Co-Packer Fees", confidence: 0.95 },
  { pattern: /albanese/i, vendor: "Albanese Confectionery", category: "COGS - Raw Materials", glAccountId: 5100, glAccountName: "Raw Materials / Ingredients", confidence: 0.95 },
  { pattern: /belmark/i, vendor: "Belmark", category: "COGS - Packaging", glAccountId: 5200, glAccountName: "Packaging Materials", confidence: 0.90 },
  { pattern: /ninja\s*print/i, vendor: "NinjaPrintHouse", category: "COGS - Labels", glAccountId: 5200, glAccountName: "Packaging / Labels", confidence: 0.90 },
  // Advertising
  { pattern: /amazon\s*advertis|amazon\s*ppc|amzn\s*mktp/i, vendor: "Amazon", category: "Marketing - PPC", glAccountId: 6200, glAccountName: "Advertising & PPC", confidence: 0.85 },
  // Insurance
  { pattern: /insurance|hartford|progressive/i, vendor: "Insurance", category: "Insurance", glAccountId: 6400, glAccountName: "Insurance", confidence: 0.80 },
  // Banking fees
  { pattern: /bank\s*(of\s*america|fee|charge)|boa\s*fee/i, vendor: "Bank of America", category: "Bank Fees", glAccountId: 6500, glAccountName: "Bank Charges & Fees", confidence: 0.90 },
  // Investor transfers (CRITICAL — liability, not income)
  { pattern: /rene\s*g/i, vendor: "Rene Gonzalez", category: "Investor Loan", glAccountId: 167, glAccountName: "Investor Loan - Rene (Liability)", confidence: 0.99 },
  { pattern: /gonzalez\s*trust/i, vendor: "Rene G Gonzalez Trust", category: "Investor Loan", glAccountId: 167, glAccountName: "Investor Loan - Rene (Liability)", confidence: 0.99 },
  // Revenue deposits
  { pattern: /shopify\s*payout|shopify\s*deposit/i, vendor: "Shopify", category: "DTC Revenue", glAccountId: 4000, glAccountName: "DTC Revenue", confidence: 0.90 },
  { pattern: /amazon\s*(settlement|payout|deposit)/i, vendor: "Amazon", category: "Amazon Revenue", glAccountId: 4010, glAccountName: "Amazon Revenue", confidence: 0.90 },
];

export function tagTransaction(description: string, amount: number): TaggedTransaction {
  const desc = description.trim();

  for (const rule of TAGGING_RULES) {
    if (rule.pattern.test(desc)) {
      return {
        plaidId: "",
        date: "",
        description: desc,
        amount,
        vendor: rule.vendor,
        category: rule.category,
        glAccountId: rule.glAccountId,
        glAccountName: rule.glAccountName,
        confidence: rule.confidence,
        isInvestorTransfer: rule.glAccountId === 167,
        rule: rule.pattern.source,
      };
    }
  }

  // No match
  return {
    plaidId: "",
    date: "",
    description: desc,
    amount,
    vendor: null,
    category: null,
    glAccountId: null,
    glAccountName: null,
    confidence: 0,
    isInvestorTransfer: false,
    rule: "none",
  };
}

export type AutoTagResult = {
  total: number;
  tagged: number;
  highConfidence: number;
  lowConfidence: number;
  unmatched: number;
  investorTransfers: number;
  transactions: TaggedTransaction[];
};

export async function runAutoTagger(): Promise<AutoTagResult> {
  const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
  const cronSecret = (process.env.CRON_SECRET || "").trim();

  let transactions: Array<{ transaction_id: string; date: string; name: string; amount: number }> = [];

  try {
    const res = await fetch(`${host}/api/ops/plaid/balance`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = (await res.json()) as { recentTransactions?: Array<{ transaction_id: string; date: string; name: string; amount: number }> };
      transactions = data.recentTransactions || [];
    }
  } catch { /* */ }

  const tagged: TaggedTransaction[] = [];
  for (const txn of transactions) {
    const result = tagTransaction(txn.name, txn.amount);
    result.plaidId = txn.transaction_id;
    result.date = txn.date;
    tagged.push(result);
  }

  const highConf = tagged.filter(t => t.confidence >= 0.85);
  const lowConf = tagged.filter(t => t.confidence > 0 && t.confidence < 0.85);
  const unmatched = tagged.filter(t => t.confidence === 0);
  const investor = tagged.filter(t => t.isInvestorTransfer);

  const result: AutoTagResult = {
    total: tagged.length,
    tagged: highConf.length + lowConf.length,
    highConfidence: highConf.length,
    lowConfidence: lowConf.length,
    unmatched: unmatched.length,
    investorTransfers: investor.length,
    transactions: tagged,
  };

  if (result.total > 0) {
    void notifyDaily(
      `🏷️ *Auto-Tagger: ${result.tagged}/${result.total} transactions tagged*\n` +
      `• ${result.highConfidence} high confidence (auto-categorizable)\n` +
      `• ${result.lowConfidence} low confidence (need review)\n` +
      `• ${result.unmatched} unmatched\n` +
      (result.investorTransfers > 0 ? `• 🔴 ${result.investorTransfers} investor transfer(s) → Liability Account 2300\n` : ""),
    );
  }

  return result;
}
