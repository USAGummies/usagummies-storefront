import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOPurchase } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.account_id) {
      return NextResponse.json({ error: "account_id (bank/CC account) is required" }, { status: 400 });
    }
    if (!body.payment_type || !["Cash", "Check", "CreditCard"].includes(body.payment_type)) {
      return NextResponse.json({ error: "payment_type must be Cash, Check, or CreditCard" }, { status: 400 });
    }
    if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: "lines array is required" }, { status: 400 });
    }

    const result = await createQBOPurchase({
      AccountRef: { value: body.account_id },
      PaymentType: body.payment_type,
      TxnDate: body.date,
      DocNumber: body.ref_number,
      PrivateNote: body.memo,
      ...(body.vendor_id ? { EntityRef: { value: body.vendor_id, type: "Vendor" } } : {}),
      Line: body.lines.map((l: { amount: number; expense_account_id: string; description?: string }) => ({
        Amount: l.amount,
        DetailType: "AccountBasedExpenseLineDetail" as const,
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: l.expense_account_id },
        },
        Description: l.description,
      })),
    });

    if (!result) {
      return NextResponse.json({ error: "QBO purchase creation failed" }, { status: 500 });
    }

    const data = (result as Record<string, unknown>).Purchase || result;
    return NextResponse.json({ ok: true, purchase: data });
  } catch (error) {
    console.error("[qbo/purchase] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Purchase creation failed" }, { status: 500 });
  }
}
