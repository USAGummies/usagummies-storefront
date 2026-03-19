import { NextResponse } from "next/server";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QBO Bank Rules Setup — creates auto-categorization rules
 * based on vendor/description patterns from Puzzle data.
 *
 * GET /api/ops/qbo/rules
 *
 * This first queries all accounts to build an ID map,
 * then creates bank rules for known vendor patterns.
 */

type RuleDef = {
  /** Text to match in bank transaction description */
  descriptionContains: string;
  /** Target QBO account name to categorize into */
  accountName: string;
};

// Vendor → Category mappings from Puzzle transaction history
const VENDOR_RULES: RuleDef[] = [
  // Software & SaaS
  { descriptionContains: "ANTHROPIC", accountName: "Software - Operating Expense" },
  { descriptionContains: "APOLLO", accountName: "Software - Operating Expense" },
  { descriptionContains: "CLAUDE", accountName: "Software - Operating Expense" },
  { descriptionContains: "CLOUDFLARE", accountName: "Software - Operating Expense" },
  { descriptionContains: "INVIDEO", accountName: "Software - Operating Expense" },
  { descriptionContains: "METRICOOL", accountName: "Software - Operating Expense" },
  { descriptionContains: "MIDJOURNEY", accountName: "Software - Operating Expense" },
  { descriptionContains: "NOTION", accountName: "Software - Operating Expense" },
  { descriptionContains: "OPENAI", accountName: "Software - Operating Expense" },
  { descriptionContains: "N8N", accountName: "Software - Operating Expense" },
  { descriptionContains: "SPARK", accountName: "Software - Operating Expense" },
  { descriptionContains: "SLACK", accountName: "Software - Operating Expense" },
  { descriptionContains: "X CORP", accountName: "Software - Operating Expense" },
  { descriptionContains: "VERCEL", accountName: "Software - Operating Expense" },
  { descriptionContains: "SUPABASE", accountName: "Software - Operating Expense" },
  { descriptionContains: "UPSTASH", accountName: "Software - Operating Expense" },

  // Advertising
  { descriptionContains: "FACEBOOK", accountName: "Advertising" },
  { descriptionContains: "FACEBK", accountName: "Advertising" },
  { descriptionContains: "META ADS", accountName: "Advertising" },
  { descriptionContains: "GOOGLE ADS", accountName: "Advertising" },
  { descriptionContains: "TIKTOK", accountName: "Advertising" },
  { descriptionContains: "CRAIGSLIST", accountName: "Advertising" },

  // Shipping
  { descriptionContains: "PIRATE SHIP", accountName: "Shipping & Delivery" },
  { descriptionContains: "USPS", accountName: "Shipping & Delivery" },
  { descriptionContains: "UPS", accountName: "Shipping & Delivery" },
  { descriptionContains: "FEDEX", accountName: "Shipping & Delivery" },

  // Insurance
  { descriptionContains: "GEICO", accountName: "Insurance" },

  // Utilities
  { descriptionContains: "T-MOBILE", accountName: "Utilities" },
  { descriptionContains: "TMOBILE", accountName: "Utilities" },

  // Ground Transportation
  { descriptionContains: "EXXON", accountName: "Ground Transportation" },
  { descriptionContains: "SHELL", accountName: "Ground Transportation" },
  { descriptionContains: "MAVERIK", accountName: "Ground Transportation" },
  { descriptionContains: "UBER", accountName: "Ground Transportation" },
  { descriptionContains: "LYFT", accountName: "Ground Transportation" },

  // Tax & Accounting
  { descriptionContains: "PILOT", accountName: "Tax and Accounting" },

  // COGS - Hosting
  { descriptionContains: "SHOPIFY", accountName: "Hosting Fees" },

  // Bank Fees
  { descriptionContains: "WIRE TRANSFER FEE", accountName: "Bank Fees" },
  { descriptionContains: "PAST DUE FEE", accountName: "Bank Fees" },
  { descriptionContains: "MONTHLY FEE", accountName: "Bank Fees" },

  // Interest
  { descriptionContains: "INTEREST CHARGE", accountName: "Interest Expense" },

  // Payment Processing
  { descriptionContains: "STRIPE", accountName: "Transfers in Transit" },

  // Credit Card Payments
  { descriptionContains: "CAPITAL ONE DES:MOBILE PMT", accountName: "Credit Card Payments" },
  { descriptionContains: "CAPITAL ONE MOBILE PYMT", accountName: "Credit Card Payments" },

  // Hardware
  { descriptionContains: "APPLE.COM", accountName: "Computers & Hardware" },

  // Contractors
  { descriptionContains: "UPWORK", accountName: "Independent Contractors" },
];

async function qboQuery(
  realmId: string,
  accessToken: string,
  query: string,
) {
  const baseUrl =
    process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

  const res = await fetch(
    `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=73`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  return res.json();
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

  // First, get all accounts to build name → ID map
  const acctData = await qboQuery(
    realmId,
    accessToken,
    "SELECT Id, Name FROM Account WHERE Active = true",
  );

  const accounts = acctData?.QueryResponse?.Account || [];
  const nameToId: Record<string, string> = {};
  for (const a of accounts) {
    nameToId[a.Name] = a.Id;
  }

  // Check which account names from rules exist
  const missing: string[] = [];
  const rulesSummary: Array<{ pattern: string; account: string; accountId: string }> = [];

  for (const rule of VENDOR_RULES) {
    const id = nameToId[rule.accountName];
    if (!id) {
      // Try partial match
      const match = Object.keys(nameToId).find(
        (n) => n.toLowerCase().includes(rule.accountName.toLowerCase()),
      );
      if (match) {
        rulesSummary.push({
          pattern: rule.descriptionContains,
          account: match,
          accountId: nameToId[match],
        });
      } else {
        missing.push(rule.accountName);
      }
    } else {
      rulesSummary.push({
        pattern: rule.descriptionContains,
        account: rule.accountName,
        accountId: id,
      });
    }
  }

  // Note: QBO doesn't have a public API for bank rules.
  // These rules need to be created manually in QBO UI:
  // Banking > Rules > Add Rule
  // But we return the mapping so it can be used as a reference.

  return NextResponse.json({
    note: "QBO does not have a public API for bank rules. Use these mappings to create rules manually in QBO: Banking > Rules > Add Rule",
    totalRules: rulesSummary.length,
    missingAccounts: [...new Set(missing)],
    rules: rulesSummary,
    allAccounts: accounts.map((a: Record<string, unknown>) => ({
      id: a.Id,
      name: a.Name,
    })),
  });
}
