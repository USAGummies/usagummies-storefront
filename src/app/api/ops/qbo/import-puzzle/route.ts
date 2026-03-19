import { NextResponse } from "next/server";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QBO Import — Categorizes bank-feed transactions using Puzzle GL mappings.
 *
 * This doesn't create new transactions (the bank feed handles that).
 * Instead it provides a categorization mapping that can be used
 * to batch-categorize transactions in QBO.
 *
 * GET /api/ops/qbo/import-puzzle
 *
 * Returns:
 * - Account ID mapping (vendor pattern → QBO account ID)
 * - Rene investor transactions that must be categorized as liability
 * - Summary of what needs manual attention
 */

// QBO Account IDs (from our setup)
const ACCOUNT_MAP: Record<string, number> = {
  "Software - Operating Expense": 165,
  "Advertising": 16, // QBO default "Advertising & marketing"
  "Shipping": 159, // Our "Shipping & Delivery"
  "Insurance": 42,
  "Utilities": 91,
  "Hosting Fees": 166,
  "Bank Fees": 160,
  "Ground Transportation": 162,
  "Services Revenue": 164,
  "Credit Card Payments": 169,
  "Interest Expense": 163,
  "Computers & Hardware": 156,
  "Entertainment": 37,
  "Tax and Accounting": 158,
  "Supplies": 83,
  "Independent Contractors": 157,
  "Lodging": 161,
  "Transfers in Transit": 168,
  "Investor Loan - Rene": 167,
};

// Vendor/description patterns → QBO category
const CATEGORIZATION_RULES: Array<{
  pattern: string;
  category: string;
  accountId: number;
}> = [
  // Software
  { pattern: "ANTHROPIC", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "APOLLO", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "CLAUDE", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "CLOUDFLARE", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "INVIDEO", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "METRICOOL", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "MIDJOURNEY", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "NOTION", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "OPENAI", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "N8N", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "SPARK", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "SLACK", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "X CORP", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "VERCEL", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "SUPABASE", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "UPSTASH", category: "Software - Operating Expense", accountId: 165 },
  { pattern: "PADDLE.NET", category: "Software - Operating Expense", accountId: 165 },

  // Advertising
  { pattern: "FACEBOOK", category: "Advertising", accountId: 16 },
  { pattern: "FACEBK", category: "Advertising", accountId: 16 },
  { pattern: "META ADS", category: "Advertising", accountId: 16 },
  { pattern: "GOOGLE ADS", category: "Advertising", accountId: 16 },
  { pattern: "TIKTOK", category: "Advertising", accountId: 16 },
  { pattern: "CRAIGSLIST", category: "Advertising", accountId: 16 },
  { pattern: "AMAZON ADS", category: "Advertising", accountId: 16 },

  // Shipping
  { pattern: "PIRATE SHIP", category: "Shipping", accountId: 159 },
  { pattern: "USPS", category: "Shipping", accountId: 159 },
  { pattern: "UPS STORE", category: "Shipping", accountId: 159 },
  { pattern: "FEDEX", category: "Shipping", accountId: 159 },

  // Insurance
  { pattern: "GEICO", category: "Insurance", accountId: 42 },

  // Utilities
  { pattern: "T-MOBILE", category: "Utilities", accountId: 91 },
  { pattern: "TMOBILE", category: "Utilities", accountId: 91 },

  // Ground Transport
  { pattern: "EXXON", category: "Ground Transportation", accountId: 162 },
  { pattern: "SHELL", category: "Ground Transportation", accountId: 162 },
  { pattern: "MAVERIK", category: "Ground Transportation", accountId: 162 },
  { pattern: "UBER", category: "Ground Transportation", accountId: 162 },
  { pattern: "LYFT", category: "Ground Transportation", accountId: 162 },

  // Tax & Accounting
  { pattern: "PILOT", category: "Tax and Accounting", accountId: 158 },

  // Hosting / COGS
  { pattern: "SHOPIFY", category: "Hosting Fees", accountId: 166 },

  // Bank Fees
  { pattern: "WIRE TRANSFER FEE", category: "Bank Fees", accountId: 160 },
  { pattern: "Wire transfer fee", category: "Bank Fees", accountId: 160 },
  { pattern: "PAST DUE FEE", category: "Bank Fees", accountId: 160 },
  { pattern: "MONTHLY FEE", category: "Bank Fees", accountId: 160 },

  // Interest
  { pattern: "INTEREST CHARGE", category: "Interest Expense", accountId: 163 },

  // Payment Processing
  { pattern: "STRIPE", category: "Transfers in Transit", accountId: 168 },

  // Credit Card Payments (internal transfers, not expenses)
  { pattern: "CAPITAL ONE DES:MOBILE PMT", category: "Credit Card Payments", accountId: 169 },
  { pattern: "CAPITAL ONE MOBILE PYMT", category: "Credit Card Payments", accountId: 169 },

  // Hardware
  { pattern: "APPLE.COM", category: "Computers & Hardware", accountId: 156 },
  { pattern: "APPLE STORE", category: "Computers & Hardware", accountId: 156 },

  // Contractors
  { pattern: "UPWORK", category: "Independent Contractors", accountId: 157 },

  // *** CRITICAL: Rene investor money = LIABILITY, not income ***
  { pattern: "RENE G. GONZALEZ", category: "Investor Loan - Rene", accountId: 167 },
  { pattern: "GONZALEZ, RENE", category: "Investor Loan - Rene", accountId: 167 },
  { pattern: "RENE G GONZALEZ", category: "Investor Loan - Rene", accountId: 167 },
];

function categorize(description: string): { category: string; accountId: number } | null {
  const upper = description.toUpperCase();
  for (const rule of CATEGORIZATION_RULES) {
    if (upper.includes(rule.pattern.toUpperCase())) {
      return { category: rule.category, accountId: rule.accountId };
    }
  }
  return null;
}

export async function GET() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to QBO" },
      { status: 401 },
    );
  }

  const realmId = await getRealmId();
  if (!realmId) {
    return NextResponse.json({ error: "No realm ID" }, { status: 500 });
  }

  // Return the categorization mapping for reference
  // QBO bank rules must be set up manually in the QBO UI
  // This endpoint serves as the definitive mapping reference

  return NextResponse.json({
    status: "ready",
    instructions: [
      "1. Upload historical BofA transactions: Banking > Upload > select 'Business Adv Fundamentals (7020)' > upload qbo-import-bofa-historical.csv",
      "2. Create bank rules in QBO: Banking > Rules > Add Rule for each vendor pattern",
      "3. CRITICAL: Any transfer from Rene G. Gonzalez / Rene G Gonzalez Trust = 'Investor Loan - Rene' (ID 167) — NOT income",
      "4. Review and categorize bank feed transactions using the rules below",
    ],
    accountMap: ACCOUNT_MAP,
    categorizationRules: CATEGORIZATION_RULES.map((r) => ({
      pattern: r.pattern,
      category: r.category,
      accountId: r.accountId,
    })),
    reneTransactionsWarning:
      "ALL transfers from Rene G. Gonzalez or the Rene G. Gonzalez Trust MUST be categorized as 'Investor Loan - Rene' (liability account ID 167). This is investor capital, NOT revenue/income.",
    csvFiles: {
      historicalBofA: "/Users/ben/Downloads/qbo-import-bofa-historical.csv (296 transactions, pre-Dec 2025)",
      allBofA: "/Users/ben/Downloads/qbo-import-bofa-7020.csv (481 transactions)",
      allCapOne: "/Users/ben/Downloads/qbo-import-capone-8133.csv (18 transactions)",
      categorizationRef: "/Users/ben/Downloads/qbo-categorization-rules.csv",
    },
  });
}
