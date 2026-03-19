import { NextResponse } from "next/server";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QBO Historical Import — imports pre-bank-feed transactions via API.
 *
 * Creates Purchase (expense) and Deposit (income) entries in QBO
 * for historical transactions from Puzzle that the bank feed won't cover.
 *
 * GET /api/ops/qbo/import-historical
 *
 * This reads from a hardcoded transaction list derived from
 * the Puzzle CSV export (296 BofA transactions before Dec 2025).
 */

// Vendor pattern → QBO Account ID mapping
const CATEGORIZATION_RULES: Array<{ pattern: string; accountId: number; accountName: string }> = [
  // Software
  { pattern: "ANTHROPIC", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "APOLLO", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "CLAUDE", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "CLOUDFLARE", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "INVIDEO", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "METRICOOL", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "MIDJOURNEY", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "NOTION LABS", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "OPENAI", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "N8N", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "SPARK", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "SLACK", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "X CORP", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "VERCEL", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "PADDLE.NET", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "GOOGLE *GSUITE", accountId: 165, accountName: "Software - Operating Expense" },

  // Advertising
  { pattern: "FACEBK", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "FACEBOOK", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "META ADS", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "GOOGLE ADS", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "TIKTOK", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "CRAIGSLIST", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "AMAZON ADS", accountId: 16, accountName: "Advertising & marketing" },

  // Shipping
  { pattern: "PIRATE SHIP", accountId: 159, accountName: "Shipping & Delivery" },
  { pattern: "USPS", accountId: 159, accountName: "Shipping & Delivery" },

  // Insurance
  { pattern: "GEICO", accountId: 42, accountName: "Insurance" },

  // Utilities
  { pattern: "T-MOBILE", accountId: 91, accountName: "Utilities" },
  { pattern: "TMOBILE", accountId: 91, accountName: "Utilities" },

  // Ground Transport
  { pattern: "EXXON", accountId: 162, accountName: "Ground Transportation" },
  { pattern: "SHELL", accountId: 162, accountName: "Ground Transportation" },
  { pattern: "MAVERIK", accountId: 162, accountName: "Ground Transportation" },

  // Tax & Accounting
  { pattern: "PILOT", accountId: 158, accountName: "Tax and Accounting" },

  // Hosting / COGS
  { pattern: "SHOPIFY", accountId: 166, accountName: "Hosting Fees" },

  // Bank Fees
  { pattern: "WIRE TRANSFER FEE", accountId: 160, accountName: "Bank Fees" },
  { pattern: "Wire transfer fee", accountId: 160, accountName: "Bank Fees" },
  { pattern: "PAST DUE FEE", accountId: 160, accountName: "Bank Fees" },
  { pattern: "MONTHLY FEE", accountId: 160, accountName: "Bank Fees" },
  { pattern: "SERVICE CHARGE", accountId: 160, accountName: "Bank Fees" },

  // Interest
  { pattern: "INTEREST CHARGE", accountId: 163, accountName: "Interest Expense" },

  // Payment Processing
  { pattern: "STRIPE", accountId: 168, accountName: "Transfers in Transit" },
  { pattern: "SQUARESPACE PAYM", accountId: 168, accountName: "Transfers in Transit" },

  // Credit Card Payments (internal transfers)
  { pattern: "CAPITAL ONE DES:MOBILE PMT", accountId: 169, accountName: "Credit Card Payments" },
  { pattern: "CAPITAL ONE MOBILE PYMT", accountId: 169, accountName: "Credit Card Payments" },

  // Hardware
  { pattern: "APPLE.COM", accountId: 156, accountName: "Computers & Hardware" },
  { pattern: "APPLE STORE", accountId: 156, accountName: "Computers & Hardware" },

  // Contractors
  { pattern: "UPWORK", accountId: 157, accountName: "Independent Contractors" },

  // Entertainment
  { pattern: "RANCH WORLD", accountId: 37, accountName: "Entertainment" },

  // Supplies
  { pattern: "VISTAPRINT", accountId: 83, accountName: "Supplies" },

  // *** CRITICAL: Rene investor money = LIABILITY ***
  { pattern: "RENE G. GONZALEZ", accountId: 167, accountName: "Investor Loan - Rene" },
  { pattern: "GONZALEZ, RENE", accountId: 167, accountName: "Investor Loan - Rene" },
  { pattern: "RENE G GONZALEZ", accountId: 167, accountName: "Investor Loan - Rene" },
];

function categorize(description: string): { accountId: number; accountName: string } | null {
  const upper = description.toUpperCase();
  for (const rule of CATEGORIZATION_RULES) {
    if (upper.includes(rule.pattern.toUpperCase())) {
      return { accountId: rule.accountId, accountName: rule.accountName };
    }
  }
  return null;
}

// BofA checking account ID in QBO
const BOFA_CHECKING_ID = 153; // "Business Adv Fundamentals (7020) - 1"

// Uncategorized expense fallback
const UNCATEGORIZED_EXPENSE_ID = 39; // "General business expenses"

async function qboPost(
  realmId: string,
  accessToken: string,
  entity: string,
  body: Record<string, unknown>,
) {
  const baseUrl =
    process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

  const res = await fetch(
    `${baseUrl}/v3/company/${realmId}/${entity}?minorversion=73`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    return { error: true, status: res.status, detail: data };
  }
  return { error: false, data };
}

/**
 * Import is done in two phases:
 * 1. GET /api/ops/qbo/import-historical — dry run, shows what would be imported
 * 2. POST /api/ops/qbo/import-historical — actually creates the transactions
 *
 * This prevents accidental duplicate imports.
 */
export async function GET() {
  // Parse the CSV file
  const fs = await import("fs");
  const path = await import("path");

  const csvPath = "/Users/ben/Downloads/84d0a5bc-66eb-4b9b-80b0-8e256b2c8402-3152920.csv";

  if (!fs.existsSync(csvPath)) {
    return NextResponse.json(
      { error: "Puzzle CSV not found at expected path", path: csvPath },
      { status: 404 },
    );
  }

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n");

  // Skip first 3 lines (title + 2 blanks), then parse CSV
  const headerLine = lines[3];
  const headers = headerLine.split(",").map((h: string) => h.replace(/"/g, "").trim());

  // Simple CSV parser (handles quoted fields)
  function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += c;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  // 90-day cutoff for what bank feed handles
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  const historicalTxns: Array<{
    date: string;
    description: string;
    amount: number;
    institution: string;
    puzzleGL: string;
    qboCategory: string | null;
    qboAccountId: number;
    isIncome: boolean;
    isTransfer: boolean;
    isInvestorLoan: boolean;
  }> = [];

  for (let i = 4; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h: string, idx: number) => {
      row[h] = fields[idx] || "";
    });

    // Only BofA, only pre-cutoff
    if (!row.Institution?.includes("Bank of America")) continue;
    if (row.Date >= cutoffStr) continue;

    const amount = parseFloat(row.Amount || "0");
    const desc = row.Description || "";
    const puzzleGL = row["GL Account Name"] || "No Category";

    const cat = categorize(desc);
    const isIncome = amount > 0;
    const isInvestorLoan = cat?.accountName === "Investor Loan - Rene";
    const isTransfer =
      cat?.accountName === "Credit Card Payments" ||
      cat?.accountName === "Transfers in Transit";

    historicalTxns.push({
      date: row.Date,
      description: desc,
      amount,
      institution: "Bank of America",
      puzzleGL,
      qboCategory: cat?.accountName || null,
      qboAccountId: cat?.accountId || UNCATEGORIZED_EXPENSE_ID,
      isIncome,
      isTransfer,
      isInvestorLoan,
    });
  }

  const categorized = historicalTxns.filter((t) => t.qboCategory !== null).length;
  const uncategorized = historicalTxns.filter((t) => t.qboCategory === null).length;
  const investorTxns = historicalTxns.filter((t) => t.isInvestorLoan);
  const transferTxns = historicalTxns.filter((t) => t.isTransfer);

  return NextResponse.json({
    mode: "dry_run",
    instructions: "POST to this endpoint to actually import. GET is dry-run only.",
    summary: {
      total: historicalTxns.length,
      categorized,
      uncategorized,
      investorLoanTransactions: investorTxns.length,
      transferTransactions: transferTxns.length,
      dateRange: {
        earliest: historicalTxns[historicalTxns.length - 1]?.date,
        latest: historicalTxns[0]?.date,
      },
    },
    investorLoanTransactions: investorTxns,
    sampleTransactions: historicalTxns.slice(0, 20),
  });
}

export async function POST() {
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

  // Parse CSV (same as GET)
  const fs = await import("fs");
  const csvPath = "/Users/ben/Downloads/84d0a5bc-66eb-4b9b-80b0-8e256b2c8402-3152920.csv";

  if (!fs.existsSync(csvPath)) {
    return NextResponse.json(
      { error: "Puzzle CSV not found" },
      { status: 404 },
    );
  }

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n");
  const headerLine = lines[3];
  const headers = headerLine.split(",").map((h: string) => h.replace(/"/g, "").trim());

  function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += c;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  const results: Array<{ date: string; description: string; amount: number; status: string; detail?: unknown }> = [];
  let created = 0;
  let errors = 0;
  let skipped = 0;

  for (let i = 4; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h: string, idx: number) => {
      row[h] = fields[idx] || "";
    });

    if (!row.Institution?.includes("Bank of America")) continue;
    if (row.Date >= cutoffStr) continue;

    const amount = parseFloat(row.Amount || "0");
    const desc = row.Description || "";
    const cat = categorize(desc);
    const accountId = cat?.accountId || UNCATEGORIZED_EXPENSE_ID;
    const isIncome = amount > 0;
    const isInvestorLoan = cat?.accountName === "Investor Loan - Rene";
    const isTransfer =
      cat?.accountName === "Credit Card Payments" ||
      cat?.accountName === "Transfers in Transit";

    // Skip internal transfers (they'd create double entries)
    if (isTransfer) {
      results.push({ date: row.Date, description: desc, amount, status: "skipped_transfer" });
      skipped++;
      continue;
    }

    if (isIncome || isInvestorLoan) {
      // Create a Deposit
      const depositBody: Record<string, unknown> = {
        TxnDate: row.Date,
        DepositToAccountRef: { value: String(BOFA_CHECKING_ID) },
        Line: [
          {
            Amount: Math.abs(amount),
            DetailType: "DepositLineDetail",
            DepositLineDetail: {
              AccountRef: { value: String(accountId) },
            },
            Description: `[Puzzle Import] ${desc}`,
          },
        ],
        PrivateNote: `Imported from Puzzle.io — ${desc}`,
      };

      const result = await qboPost(realmId, accessToken, "deposit", depositBody);
      if (result.error) {
        results.push({ date: row.Date, description: desc, amount, status: "error", detail: result.detail });
        errors++;
      } else {
        results.push({ date: row.Date, description: desc, amount, status: "created" });
        created++;
      }
    } else {
      // Create a Purchase (expense)
      const purchaseBody: Record<string, unknown> = {
        TxnDate: row.Date,
        PaymentType: "Check", // Generic payment from bank account
        AccountRef: { value: String(BOFA_CHECKING_ID) },
        Line: [
          {
            Amount: Math.abs(amount),
            DetailType: "AccountBasedExpenseLineDetail",
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: String(accountId) },
            },
            Description: `[Puzzle Import] ${desc}`,
          },
        ],
        PrivateNote: `Imported from Puzzle.io — ${desc}`,
      };

      const result = await qboPost(realmId, accessToken, "purchase", purchaseBody);
      if (result.error) {
        results.push({ date: row.Date, description: desc, amount, status: "error", detail: result.detail });
        errors++;
      } else {
        results.push({ date: row.Date, description: desc, amount, status: "created" });
        created++;
      }
    }

    // Rate limit: slight delay every 10 transactions
    if ((created + errors) % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return NextResponse.json({
    mode: "import_complete",
    summary: {
      total: results.length,
      created,
      errors,
      skippedTransfers: skipped,
    },
    errors: results.filter((r) => r.status === "error"),
    firstFew: results.slice(0, 10),
  });
}
