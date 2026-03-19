import { NextResponse } from "next/server";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QBO Batch Import — receives transactions as JSON and creates
 * Purchase/Deposit entries in QBO.
 *
 * POST /api/ops/qbo/import-batch
 * Body: { transactions: Array<{ date, description, amount, accountId, isIncome, bankAccountId }> }
 */

type ImportTransaction = {
  date: string;
  description: string;
  amount: number;
  accountId: number;
  isIncome: boolean;
  bankAccountId: number;
};

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

export async function POST(req: Request) {
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

  const body = await req.json();
  const transactions: ImportTransaction[] = body.transactions || [];

  if (transactions.length === 0) {
    return NextResponse.json({ error: "No transactions provided" }, { status: 400 });
  }

  if (transactions.length > 50) {
    return NextResponse.json({ error: "Max 50 transactions per batch" }, { status: 400 });
  }

  let created = 0;
  let errors = 0;
  const errorDetails: Array<{ description: string; detail: unknown }> = [];

  for (const txn of transactions) {
    const absAmount = Math.abs(txn.amount);

    if (txn.isIncome) {
      // Create a Deposit
      const depositBody: Record<string, unknown> = {
        TxnDate: txn.date,
        DepositToAccountRef: { value: String(txn.bankAccountId) },
        Line: [
          {
            Amount: absAmount,
            DetailType: "DepositLineDetail",
            DepositLineDetail: {
              AccountRef: { value: String(txn.accountId) },
            },
            Description: `[Puzzle Import] ${txn.description}`,
          },
        ],
        PrivateNote: `Imported from Puzzle.io`,
      };

      const result = await qboPost(realmId, accessToken, "deposit", depositBody);
      if (result.error) {
        errors++;
        errorDetails.push({ description: txn.description, detail: result.detail });
      } else {
        created++;
      }
    } else {
      // Create a Purchase (expense)
      const purchaseBody: Record<string, unknown> = {
        TxnDate: txn.date,
        PaymentType: "Check",
        AccountRef: { value: String(txn.bankAccountId) },
        Line: [
          {
            Amount: absAmount,
            DetailType: "AccountBasedExpenseLineDetail",
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: String(txn.accountId) },
            },
            Description: `[Puzzle Import] ${txn.description}`,
          },
        ],
        PrivateNote: `Imported from Puzzle.io`,
      };

      const result = await qboPost(realmId, accessToken, "purchase", purchaseBody);
      if (result.error) {
        errors++;
        errorDetails.push({ description: txn.description, detail: result.detail });
      } else {
        created++;
      }
    }
  }

  return NextResponse.json({
    created,
    errors,
    total: transactions.length,
    errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
  });
}
