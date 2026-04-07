import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOPayment } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.customer_id) {
      return NextResponse.json(
        { error: "customer_id is required" },
        { status: 400 },
      );
    }
    if (typeof body.amount !== "number" || body.amount <= 0) {
      return NextResponse.json(
        { error: "amount must be a positive number" },
        { status: 400 },
      );
    }

    const result = await createQBOPayment({
      TotalAmt: body.amount,
      CustomerRef: { value: body.customer_id, name: body.customer_name },
      ...(body.deposit_to_account_id
        ? { DepositToAccountRef: { value: body.deposit_to_account_id } }
        : {}),
      ...(body.payment_method_id
        ? { PaymentMethodRef: { value: body.payment_method_id } }
        : {}),
      TxnDate: body.date,
      PrivateNote: body.memo,
      ...(body.invoice_ids
        ? {
            Line: (body.invoice_ids as string[]).map((id: string) => ({
              Amount: body.amount / (body.invoice_ids as string[]).length,
              LinkedTxn: [{ TxnId: id, TxnType: "Invoice" as const }],
            })),
          }
        : {}),
    });

    if (!result) {
      return NextResponse.json(
        { error: "QBO payment creation failed" },
        { status: 500 },
      );
    }

    const data = (result as Record<string, unknown>).Payment || result;
    return NextResponse.json({ ok: true, payment: data });
  } catch (error) {
    console.error(
      "[qbo/payment] POST failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Payment creation failed" },
      { status: 500 },
    );
  }
}
