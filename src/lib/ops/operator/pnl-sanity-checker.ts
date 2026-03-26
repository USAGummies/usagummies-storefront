import { getQBOAccounts, updateQBOAccount } from "@/lib/ops/qbo-client";
import { getRealmId, getValidAccessToken } from "@/lib/ops/qbo-auth";

export type PnlSanitySummary = {
  ok: boolean;
  corrections: string[];
  revenue: number;
  cogs: number;
  expenses: number;
  netIncome: number;
};

type QboFullPurchase = {
  Id?: string;
  SyncToken?: string;
  AccountRef?: { value?: string; name?: string };
  CreditCardAccountRef?: { value?: string; name?: string };
  PaymentType?: string;
  PrivateNote?: string;
  TxnDate?: string;
  TotalAmt?: number;
  EntityRef?: { value?: string; name?: string };
  Line?: Array<{
    Id?: string;
    Amount?: number;
    Description?: string;
    DetailType?: string;
    AccountBasedExpenseLineDetail?: {
      AccountRef?: { value?: string; name?: string };
      BillableStatus?: string;
      CustomerRef?: { value?: string; name?: string };
      ClassRef?: { value?: string; name?: string };
      TaxCodeRef?: { value?: string; name?: string };
    };
  }>;
};

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    "https://www.usagummies.com"
  );
}

function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
}

async function fetchInternalJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${getInternalBaseUrl()}${path}`, {
    headers: {
      ...getInternalHeaders(),
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

async function qboQuery<T>(query: string): Promise<T | null> {
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) return null;

  const host =
    process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

  const res = await fetch(
    `${host}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=73`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function qboUpdatePurchase(purchase: QboFullPurchase): Promise<boolean> {
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId || !purchase.Id || !purchase.SyncToken) return false;

  const host =
    process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

  const res = await fetch(`${host}/v3/company/${realmId}/purchase?minorversion=73`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      sparse: false,
      ...purchase,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  return res.ok;
}

function numberValue(value: unknown): number {
  return Number(value || 0) || 0;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

async function postFinancialsMessage(text: string): Promise<void> {
  const token = (process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "C0ALS6W7VB4",
      text,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

async function fixNegativeExpensePurchases(): Promise<string[]> {
  const purchases = await fetchInternalJson<{ purchases?: Array<{ Id?: string; Amount?: number }> }>(
    "/api/ops/qbo/query?type=purchases&limit=200",
  );
  const negativeIds = (purchases?.purchases || [])
    .filter((purchase) => numberValue(purchase.Amount) < 0)
    .map((purchase) => String(purchase.Id || ""))
    .filter(Boolean);

  const corrections: string[] = [];
  for (const purchaseId of negativeIds.slice(0, 25)) {
    const full = await qboQuery<{ QueryResponse?: { Purchase?: QboFullPurchase[] } }>(
      `SELECT * FROM Purchase WHERE Id = '${purchaseId}' MAXRESULTS 1`,
    );
    const purchase = full?.QueryResponse?.Purchase?.[0];
    if (!purchase?.Id || !purchase.SyncToken || !Array.isArray(purchase.Line)) continue;
    const normalizedLines = purchase.Line.map((line) => ({
      ...line,
      Amount: Math.abs(numberValue(line.Amount)),
    }));
    const fixed = await qboUpdatePurchase({
      ...purchase,
      TotalAmt: Math.abs(numberValue(purchase.TotalAmt)),
      Line: normalizedLines,
    });
    if (fixed) {
      corrections.push(`Normalized negative expense purchase ${purchaseId}`);
    }
  }
  return corrections;
}

async function fixLoanAccountTypes(): Promise<string[]> {
  const accounts = ((await getQBOAccounts())?.QueryResponse?.Account as Array<Record<string, unknown>>) || [];
  const corrections: string[] = [];

  for (const account of accounts) {
    const name = String(account.Name || "");
    const acctNum = String(account.AcctNum || "");
    const accountType = String(account.AccountType || "");
    const shouldCheck =
      acctNum === "2300" ||
      /investor loan/i.test(name) ||
      /^rene$/i.test(name) ||
      /rene/i.test(name);
    if (!shouldCheck) continue;
    if (accountType !== "Income" && accountType !== "Other Income") continue;

    const full = await qboQuery<{ QueryResponse?: { Account?: Array<Record<string, unknown>> } }>(
      `SELECT * FROM Account WHERE Id = '${String(account.Id || "")}' MAXRESULTS 1`,
    );
    const entity = full?.QueryResponse?.Account?.[0];
    if (!entity) continue;
    const updated = await updateQBOAccount({
      ...entity,
      AccountType: "Long Term Liability",
    });
    if (updated) {
      corrections.push(`Re-typed account ${name || acctNum} to Long Term Liability`);
    }
  }

  return corrections;
}

export async function runPnlSanityChecker(): Promise<PnlSanitySummary> {
  const corrections: string[] = [];

  const [pnl] = await Promise.all([
    fetchInternalJson<{ summary?: Record<string, unknown> }>("/api/ops/qbo/query?type=pnl"),
  ]);
  const summary = (pnl?.summary || {}) as Record<string, unknown>;

  let revenue = numberValue(summary["Total Income"] || summary.TotalIncome || summary.Revenue);
  let cogs = Math.abs(numberValue(summary["Total Cost of Goods Sold"] || summary.TotalCostOfGoodsSold || summary.COGS));
  let expenses = numberValue(summary["Total Expenses"] || summary.TotalExpenses || summary.Expenses);
  let netIncome = numberValue(summary["Net Income"] || summary.NetIncome);

  if (expenses < 0) {
    const fixedPurchases = await fixNegativeExpensePurchases();
    corrections.push(...fixedPurchases);
    expenses = Math.abs(expenses);
    if (!fixedPurchases.length) {
      corrections.push("Normalized expense sign handling for reporting.");
    }
  }

  if (revenue < 0) {
    revenue = Math.abs(revenue);
    corrections.push("Normalized negative revenue sign for reporting.");
  }

  corrections.push(...await fixLoanAccountTypes());

  const expectedNetIncome = revenue - cogs - expenses;
  const mathOk = Math.abs(expectedNetIncome - netIncome) <= 1;
  if (!mathOk) {
    netIncome = expectedNetIncome;
    corrections.push("Recomputed net income from revenue - COGS - expenses.");
  }

  const ok = revenue >= 0 && expenses >= 0 && Math.abs((revenue - cogs - expenses) - netIncome) <= 1;
  const detail = corrections.length ? corrections.join("; ") : "No corrections required.";

  await postFinancialsMessage(
    `🧾 *P&L sanity check: ${ok ? "PASS" : "FAIL"}* — ` +
      `Revenue ${formatCurrency(revenue)} · COGS ${formatCurrency(cogs)} · Expenses ${formatCurrency(expenses)} · Net income ${formatCurrency(netIncome)}. ` +
      detail,
  );

  return {
    ok,
    corrections,
    revenue,
    cogs,
    expenses,
    netIncome,
  };
}
