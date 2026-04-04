import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBODeposit } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.deposit_to_account_id) {
      return NextResponse.json({ error: "deposit_to_account_id is required" }, { status: 400 });
    }
    if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: "lines array is required" }, { status: 400 });
    }

    const result = await createQBODeposit({
      DepositToAccountRef: { value: body.deposit_to_account_id },
      TxnDate: body.date,
      PrivateNote: body.memo,
      Line: body.lines.map((l: { amount: number; account_id: string; description?: string; entity_id?: string; entity_type?: string }) => ({
        Amount: l.amount,
        DetailType: "DepositLineDetail" as const,
        DepositLineDetail: {
          AccountRef: { value: l.account_id },
          ...(l.entity_id ? { Entity: { value: l.entity_id, type: l.entity_type } } : {}),
        },
        Description: l.description,
      })),
    });

    if (!result) {
      return NextResponse.json({ error: "QBO deposit creation failed" }, { status: 500 });
    }

    const data = (result as Record<string, unknown>).Deposit || result;
    return NextResponse.json({ ok: true, deposit: data });
  } catch (error) {
    console.error("[qbo/deposit] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Deposit creation failed" }, { status: 500 });
  }
}
