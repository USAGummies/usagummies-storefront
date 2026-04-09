import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOPayment, voidQBOPayment, deleteQBOPayment } from "@/lib/ops/qbo-client";

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

/**
 * DELETE /api/ops/qbo/payment — Void or delete a payment
 *
 * Body: { id, sync_token, action?: "void" | "delete" }
 * Default action is "void" (safer — leaves audit trail in QBO)
 */
export async function DELETE(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || body.sync_token === undefined) {
      return NextResponse.json(
        { error: "id and sync_token are required" },
        { status: 400 },
      );
    }

    const action = body.action || "void";

    let result;
    if (action === "delete") {
      result = await deleteQBOPayment(body.id, body.sync_token);
    } else {
      result = await voidQBOPayment(body.id, body.sync_token);
    }

    if (!result) {
      return NextResponse.json(
        { error: `Failed to ${action} payment ${body.id}` },
        { status: 500 },
      );
    }

    const data = (result as Record<string, unknown>).Payment || result;
    return NextResponse.json({ ok: true, action, payment: data });
  } catch (error) {
    console.error("[qbo/payment] DELETE failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Payment void/delete failed" }, { status: 500 });
  }
}
