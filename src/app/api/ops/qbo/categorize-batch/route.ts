import { NextResponse } from "next/server";
import { z } from "zod";
import { notify } from "@/lib/ops/notify";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  QBO_CATEGORIZATION_RULES,
  isReneInvestorTransfer,
  qboCategorize,
} from "@/lib/ops/abra-actions";
import { getRealmId, getValidAccessToken } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  mode: z.enum(["preview", "execute"]).default("preview"),
  transactionIds: z.array(z.string().trim().min(1)).max(200).optional(),
});

type QBOAccount = {
  Id: string;
  Name?: string;
  FullyQualifiedName?: string;
};

type QBOLine = {
  Id?: string;
  Amount?: number;
  Description?: string;
  DetailType?: string;
  AccountBasedExpenseLineDetail?: {
    AccountRef?: { value?: string; name?: string };
  };
  DepositLineDetail?: {
    AccountRef?: { value?: string; name?: string };
  };
};

type QBOPurchase = {
  Id: string;
  SyncToken: string;
  TxnDate?: string;
  PaymentType?: string;
  AccountRef?: { value?: string; name?: string };
  PrivateNote?: string;
  Line?: QBOLine[];
};

type QBODeposit = {
  Id: string;
  SyncToken: string;
  TxnDate?: string;
  DepositToAccountRef?: { value?: string; name?: string };
  PrivateNote?: string;
  Line?: QBOLine[];
};

type PreviewRow = {
  transactionId: string;
  entityType: "Purchase" | "Deposit";
  description: string;
  date: string;
  amount: number;
  currentAccountId: string;
  currentAccountName: string;
  suggestedAccountId: number | null;
  suggestedAccountName: string | null;
  confidence: number;
  needsReview: boolean;
  isReneTransfer: boolean;
  syncToken: string;
};

function getBaseUrl(realmId: string): string {
  const host = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return `${host}/v3/company/${realmId}`;
}

async function qboQuery<T>(realmId: string, accessToken: string, query: string): Promise<T | null> {
  const res = await fetch(`${getBaseUrl(realmId)}/query?query=${encodeURIComponent(query)}&minorversion=73`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function qboUpdate(
  realmId: string,
  accessToken: string,
  entity: "purchase" | "deposit",
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${getBaseUrl(realmId)}/${entity}?minorversion=73`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => "");
  return { ok: false, error: text.slice(0, 300) || `HTTP ${res.status}` };
}

function getUncategorizedAccountIds(accounts: QBOAccount[]): Set<string> {
  return new Set(
    accounts
      .filter((account) => {
        const haystack = `${account.Name || ""} ${account.FullyQualifiedName || ""}`.toLowerCase();
        return haystack.includes("uncategorized") || haystack.includes("ask my accountant");
      })
      .map((account) => account.Id)
      .filter((id): id is string => !!id),
  );
}

function classifyRow(
  entityType: "Purchase" | "Deposit",
  row: QBOPurchase | QBODeposit,
  uncategorizedIds: Set<string>,
): PreviewRow[] {
  const lines = Array.isArray(row.Line) ? row.Line : [];
  const txDate = String(row.TxnDate || "").slice(0, 10);
  return lines.flatMap((line) => {
    const accountRef = entityType === "Purchase"
      ? line.AccountBasedExpenseLineDetail?.AccountRef
      : line.DepositLineDetail?.AccountRef;
    const currentAccountId = String(accountRef?.value || "");
    if (!currentAccountId || (uncategorizedIds.size > 0 && !uncategorizedIds.has(currentAccountId))) {
      return [];
    }

    const description = String(line.Description || row.PrivateNote || `${entityType} ${row.Id}`);
    const amount = Number(line.Amount || 0);
    const investorTransfer = isReneInvestorTransfer(description);
    const category = investorTransfer
      ? { accountId: 167, accountName: "Investor Loan - Rene" }
      : qboCategorize(description);
    const confidence = investorTransfer ? 1 : category ? 0.95 : 0;

    return [{
      transactionId: row.Id,
      entityType,
      description,
      date: txDate,
      amount,
      currentAccountId,
      currentAccountName: String(accountRef?.name || ""),
      suggestedAccountId: category?.accountId || null,
      suggestedAccountName: category?.accountName || null,
      confidence,
      needsReview: !category,
      isReneTransfer: investorTransfer,
      syncToken: row.SyncToken,
    }];
  });
}

function dedupePreview(rows: PreviewRow[]): PreviewRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.entityType}:${row.transactionId}:${row.currentAccountId}:${row.suggestedAccountId || "none"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO is not connected" }, { status: 401 });
  }

  const accountsData = await qboQuery<{ QueryResponse?: { Account?: QBOAccount[] } }>(
    realmId,
    accessToken,
    "SELECT * FROM Account MAXRESULTS 500",
  );
  const accounts = accountsData?.QueryResponse?.Account || [];
  const uncategorizedIds = getUncategorizedAccountIds(accounts);
  const purchasesData = await qboQuery<{ QueryResponse?: { Purchase?: QBOPurchase[] } }>(
    realmId,
    accessToken,
    "SELECT * FROM Purchase MAXRESULTS 200",
  );
  const depositsData = await qboQuery<{ QueryResponse?: { Deposit?: QBODeposit[] } }>(
    realmId,
    accessToken,
    "SELECT * FROM Deposit MAXRESULTS 200",
  );

  const preview = dedupePreview([
    ...(purchasesData?.QueryResponse?.Purchase || []).flatMap((row) => classifyRow("Purchase", row, uncategorizedIds)),
    ...(depositsData?.QueryResponse?.Deposit || []).flatMap((row) => classifyRow("Deposit", row, uncategorizedIds)),
  ]);

  const filtered = parsed.data.transactionIds && parsed.data.transactionIds.length > 0
    ? preview.filter((row) => parsed.data.transactionIds?.includes(row.transactionId))
    : preview;

  if (parsed.data.mode === "preview") {
    return NextResponse.json({
      total: filtered.length,
      autoCategorizeable: filtered.filter((row) => row.suggestedAccountId).length,
      needsReview: filtered.filter((row) => row.needsReview).length,
      reneTransfers: filtered.filter((row) => row.isReneTransfer).length,
      rulesLoaded: QBO_CATEGORIZATION_RULES.length,
      preview: filtered.slice(0, 50),
    });
  }

  let categorized = 0;
  let errors = 0;
  let reneAlerts = 0;
  const errorDetails: Array<{ transactionId: string; error: string }> = [];

  for (const row of filtered.filter((item) => item.suggestedAccountId)) {
    const update = row.entityType === "Purchase"
      ? await qboUpdate(realmId, accessToken, "purchase", {
          sparse: true,
          Id: row.transactionId,
          SyncToken: row.syncToken,
          Line: [
            {
              Amount: row.amount,
              Description: row.description,
              DetailType: "AccountBasedExpenseLineDetail",
              AccountBasedExpenseLineDetail: {
                AccountRef: { value: String(row.suggestedAccountId) },
              },
            },
          ],
        })
      : await qboUpdate(realmId, accessToken, "deposit", {
          sparse: true,
          Id: row.transactionId,
          SyncToken: row.syncToken,
          Line: [
            {
              Amount: row.amount,
              Description: row.description,
              DetailType: "DepositLineDetail",
              DepositLineDetail: {
                AccountRef: { value: String(row.suggestedAccountId) },
              },
            },
          ],
        });

    if (update.ok) {
      categorized += 1;
      if (row.isReneTransfer) {
        reneAlerts += 1;
        await notify({
          channel: "alerts",
          text: `:money_with_wings: *Investor Loan Detected in Batch*\n*Transaction:* ${row.description}\n*Amount:* $${Math.abs(row.amount).toFixed(2)}\n*Category:* Investor Loan - Rene`,
        }).catch(() => {});
      }
    } else {
      errors += 1;
      errorDetails.push({ transactionId: row.transactionId, error: update.error || "Unknown error" });
    }
  }

  return NextResponse.json({
    categorized,
    errors,
    reneAlerts,
    totalAttempted: filtered.filter((row) => row.suggestedAccountId).length,
    errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
  });
}
