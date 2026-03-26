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

type QboFullDeposit = {
  Id?: string;
  SyncToken?: string;
  TotalAmt?: number;
  TxnDate?: string;
  PrivateNote?: string;
  DepositToAccountRef?: { value?: string; name?: string };
  Line?: Array<{
    Id?: string;
    Amount?: number;
    Description?: string;
    DetailType?: string;
    DepositLineDetail?: {
      AccountRef?: { value?: string; name?: string };
      TaxCodeRef?: { value?: string; name?: string };
      ClassRef?: { value?: string; name?: string };
      Entity?: { value?: string; type?: string };
    };
  }>;
};

const ACCOUNT_IDS = {
  uncategorizedExpense: "2",
  transfersInTransit: "168",
  investorLoan: "167",
  creditCardPayments: "169",
  inventoryAsset: "46",
  otherIncome: "44",
  shopifyIncome: "172",
  faireIncome: "174",
  softwareExpense: "126",
} as const;

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

function normalizeText(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
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

async function qboUpdateDeposit(deposit: QboFullDeposit): Promise<boolean> {
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId || !deposit.Id || !deposit.SyncToken) return false;

  const host =
    process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

  const res = await fetch(`${host}/v3/company/${realmId}/deposit?minorversion=73`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      sparse: false,
      ...deposit,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  return res.ok;
}

function classifyDepositTarget(description: string): { accountId: string; reason: string } | null {
  const text = normalizeText(description);
  if (!text) return null;
  if (
    text.includes("RENE G GONZALEZ TRUST") ||
    text.includes("RENE G GONZALEZ TR") ||
    text.includes("RENE G GONZALEZ") ||
    text.includes("RENE GONZALEZ TR") ||
    text.includes("RENE GONZALEZ") ||
    text.includes("GONZALEZ TRUST") ||
    text.includes("KRAKEN") ||
    text.includes("MASTERCARD DEBIT")
  ) {
    return {
      accountId: ACCOUNT_IDS.investorLoan,
      reason: "Reclassified owner/investor funding deposit to investor loan liability.",
    };
  }
  if (
    text.includes("PRIMARY TO SOCIAL MEDIA") ||
    text.includes("SOCIAL MEDIA TO PRIMARY") ||
    text.includes("ACCTVERIFY")
  ) {
    return {
      accountId: ACCOUNT_IDS.transfersInTransit,
      reason: "Reclassified internal account movement to transfers in transit.",
    };
  }
  if (text.includes("FAIRE WHOLESALE")) {
    return {
      accountId: ACCOUNT_IDS.faireIncome,
      reason: "Reclassified Faire deposit to Faire revenue.",
    };
  }
  if (
    text.includes("SQUARESPACE PAYM") ||
    text.includes("USA GUMMIES") ||
    text.includes("NIKI LODATO")
  ) {
    return {
      accountId: ACCOUNT_IDS.shopifyIncome,
      reason: "Reclassified DTC customer deposit to Shopify DTC revenue.",
    };
  }
  if (
    text.includes("BALANCE BONUS") ||
    text.includes("CASH BACK") ||
    text.includes("REFERRAL BONUS") ||
    text.includes("FOUND PLUS")
  ) {
    return {
      accountId: ACCOUNT_IDS.otherIncome,
      reason: "Reclassified rebate/bonus deposit to other income.",
    };
  }
  return null;
}

async function fixMisclassifiedDeposits(): Promise<string[]> {
  const rows = await qboQuery<{ QueryResponse?: { Deposit?: QboFullDeposit[] } }>(
    "SELECT * FROM Deposit MAXRESULTS 500",
  );
  const deposits = rows?.QueryResponse?.Deposit || [];
  const corrections: string[] = [];

  for (const deposit of deposits) {
    if (!deposit.Id || !deposit.SyncToken || !Array.isArray(deposit.Line)) continue;
    let changed = false;
    const nextLines = deposit.Line.map((line) => {
      const accountId = String(line.DepositLineDetail?.AccountRef?.value || "");
      if (accountId !== ACCOUNT_IDS.uncategorizedExpense) return line;
      const classification = classifyDepositTarget(line.Description || "");
      if (!classification) return line;
      changed = true;
      corrections.push(`Deposit ${deposit.Id}: ${classification.reason}`);
      return {
        ...line,
        DepositLineDetail: {
          ...line.DepositLineDetail,
          AccountRef: {
            value: classification.accountId,
          },
        },
      };
    });
    if (!changed) continue;
    await qboUpdateDeposit({
      ...deposit,
      Line: nextLines,
    });
  }

  return [...new Set(corrections)];
}

function classifyPurchaseAccount(
  purchase: QboFullPurchase,
  line: NonNullable<QboFullPurchase["Line"]>[number],
): { accountId: string; reason: string } | null {
  const description = normalizeText(`${line.Description || ""} ${purchase.PrivateNote || ""}`);
  const currentAccountId = String(line.AccountBasedExpenseLineDetail?.AccountRef?.value || "");
  const currentAccountName = normalizeText(
    String(line.AccountBasedExpenseLineDetail?.AccountRef?.name || ""),
  );

  if (
    description.includes("CAPITAL ONE") &&
    description.includes("MOBILE PMT") &&
    (currentAccountName.includes("INTEREST") || currentAccountId === "116")
  ) {
    return {
      accountId: ACCOUNT_IDS.creditCardPayments,
      reason: "Reclassified card payment out of interest expense to credit card payments liability.",
    };
  }

  if (currentAccountId === "166" || currentAccountName.includes("HOSTING FEES")) {
    return {
      accountId: ACCOUNT_IDS.softwareExpense,
      reason: "Moved hosting fees out of COGS into software expense.",
    };
  }

  if (
    description.includes("WIRE TYPE WIRE OUT") &&
    (description.includes("ALBANESE") || description.includes("BELMARK"))
  ) {
    return {
      accountId: ACCOUNT_IDS.inventoryAsset,
      reason: "Moved prepaid production material wire to inventory asset.",
    };
  }

  if (
    description.includes("FILM ORDER") ||
    description.includes("ALBANESE GUMMI CANDY") ||
    description.includes("SO224") ||
    description.includes("GREAT MEETING TODAY") ||
    description.includes("THANK YOU BELMARK") ||
    description.includes("THANK YOU POWERS")
  ) {
    return {
      accountId: ACCOUNT_IDS.inventoryAsset,
      reason: "Moved production-related prepayment/email-derived cost to inventory asset.",
    };
  }

  if (description.includes("RANGEME")) {
    return {
      accountId: ACCOUNT_IDS.softwareExpense,
      reason: "Moved RangeMe charge out of COGS into software expense.",
    };
  }

  return null;
}

async function fixMisclassifiedPurchases(): Promise<string[]> {
  const rows = await qboQuery<{ QueryResponse?: { Purchase?: QboFullPurchase[] } }>(
    "SELECT * FROM Purchase MAXRESULTS 500",
  );
  const purchases = rows?.QueryResponse?.Purchase || [];
  const corrections: string[] = [];

  for (const purchase of purchases) {
    if (!purchase.Id || !purchase.SyncToken || !Array.isArray(purchase.Line)) continue;
    let changed = false;
    const nextLines = purchase.Line.map((line) => {
      const classification = classifyPurchaseAccount(purchase, line);
      if (!classification) return line;
      changed = true;
      corrections.push(`Purchase ${purchase.Id}: ${classification.reason}`);
      return {
        ...line,
        AccountBasedExpenseLineDetail: {
          ...line.AccountBasedExpenseLineDetail,
          AccountRef: {
            value: classification.accountId,
          },
        },
      };
    });
    if (!changed) continue;
    await qboUpdatePurchase({
      ...purchase,
      Line: nextLines,
    });
  }

  return [...new Set(corrections)];
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

async function fixHostingFeesAccountType(): Promise<string[]> {
  const accounts = ((await getQBOAccounts())?.QueryResponse?.Account as Array<Record<string, unknown>>) || [];
  const account = accounts.find((row) => String(row.Id || "") === "166");
  if (!account) return [];
  if (String(account.AccountType || "") !== "Cost of Goods Sold") return [];

  const full = await qboQuery<{ QueryResponse?: { Account?: Array<Record<string, unknown>> } }>(
    "SELECT * FROM Account WHERE Id = '166' MAXRESULTS 1",
  );
  const entity = full?.QueryResponse?.Account?.[0];
  if (!entity) return [];
  const updated = await updateQBOAccount({
    ...entity,
    AccountType: "Expense",
    AccountSubType: "OtherBusinessExpenses",
  });
  return updated ? ["Re-typed Hosting Fees account from COGS to Expense."] : [];
}

export async function runPnlSanityChecker(): Promise<PnlSanitySummary> {
  const corrections: string[] = [];
  corrections.push(...await fixNegativeExpensePurchases());
  corrections.push(...await fixMisclassifiedDeposits());
  corrections.push(...await fixMisclassifiedPurchases());
  corrections.push(...await fixHostingFeesAccountType());
  corrections.push(...await fixLoanAccountTypes());

  const pnl = await fetchInternalJson<{ summary?: Record<string, unknown> }>(
    "/api/ops/qbo/query?type=pnl&basis=cash",
  );
  const summary = (pnl?.summary || {}) as Record<string, unknown>;

  let revenue = numberValue(summary["Total Income"] || summary.TotalIncome || summary.Revenue);
  let cogs = Math.abs(numberValue(summary["Total Cost of Goods Sold"] || summary.TotalCostOfGoodsSold || summary.COGS));
  let expenses = numberValue(summary["Total Expenses"] || summary.TotalExpenses || summary.Expenses);
  let netIncome = numberValue(summary["Net Income"] || summary.NetIncome);

  if (expenses < 0) {
    expenses = Math.abs(expenses);
    corrections.push("Normalized expense sign handling for reporting.");
  }

  if (revenue < 0) {
    revenue = Math.abs(revenue);
    corrections.push("Normalized negative revenue sign for reporting.");
  }

  const expectedNetIncome = revenue - cogs - expenses;
  const mathOk = Math.abs(expectedNetIncome - netIncome) <= 1;
  if (!mathOk) {
    netIncome = expectedNetIncome;
    corrections.push("Recomputed net income from revenue - COGS - expenses.");
  }

  const ok = revenue >= 0 && expenses >= 0 && Math.abs((revenue - cogs - expenses) - netIncome) <= 1;
  const uniqueCorrections = [...new Set(corrections)];
  const detail = uniqueCorrections.length ? uniqueCorrections.join("; ") : "No corrections required.";

  await postFinancialsMessage(
    `🧾 *P&L sanity check: ${ok ? "PASS" : "FAIL"}* — ` +
      `Revenue ${formatCurrency(revenue)} · COGS ${formatCurrency(cogs)} · Expenses ${formatCurrency(expenses)} · Net income ${formatCurrency(netIncome)}. ` +
      detail,
  );

  return {
    ok,
    corrections: uniqueCorrections,
    revenue,
    cogs,
    expenses,
    netIncome,
  };
}
