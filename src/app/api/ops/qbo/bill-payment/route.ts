import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOBillPayment, voidQBOBillPayment } from "@/lib/ops/qbo-client";
import { validateQBOWrite, logQBOAudit } from "@/lib/ops/qbo-guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.vendor_id) {
      return NextResponse.json({ error: "vendor_id is required" }, { status: 400 });
    }
    if (!body.total_amount || typeof body.total_amount !== "number") {
      return NextResponse.json({ error: "total_amount (number) is required" }, { status: 400 });
    }
    if (!body.pay_type || !["Check", "CreditCard"].includes(body.pay_type)) {
      return NextResponse.json({ error: "pay_type must be Check or CreditCard" }, { status: 400 });
    }
    if (!body.bill_ids || !Array.isArray(body.bill_ids) || body.bill_ids.length === 0) {
      return NextResponse.json({ error: "bill_ids array is required" }, { status: 400 });
    }

    const paymentMethod = body.pay_type === "Check"
      ? { CheckPayment: { BankAccountRef: { value: body.bank_account_id } } }
      : { CreditCardPayment: { CCAccountRef: { value: body.cc_account_id } } };

    if (body.pay_type === "Check" && !body.bank_account_id) {
      return NextResponse.json({ error: "bank_account_id is required for Check payments" }, { status: 400 });
    }
    if (body.pay_type === "CreditCard" && !body.cc_account_id) {
      return NextResponse.json({ error: "cc_account_id is required for CreditCard payments" }, { status: 400 });
    }

    const bpPayload = {
      VendorRef: { value: body.vendor_id },
      TotalAmt: body.total_amount,
      PayType: body.pay_type,
      ...paymentMethod,
      Line: body.bill_ids.map((billId: string, i: number) => ({
        Amount: body.amounts?.[i] ?? body.total_amount / body.bill_ids.length,
        LinkedTxn: [{ TxnId: billId, TxnType: "Bill" as const }],
      })),
      TxnDate: body.date,
      PrivateNote: body.memo,
    };

    // ── GUARDRAIL: Validate before writing (this moves money) ──
    const isDryRun = body.dry_run === true;
    const validation = await validateQBOWrite(
      "bill-payment",
      bpPayload as unknown as Record<string, unknown>,
      { dry_run: isDryRun, caller: body.caller || "viktor" },
    );

    await logQBOAudit({
      entity_type: "bill-payment",
      action: "create",
      endpoint: "/api/ops/qbo/bill-payment",
      amount: body.total_amount,
      vendor_or_customer: `vendor:${body.vendor_id}`,
      dry_run: isDryRun,
      validation_passed: validation.valid,
      issues: validation.issues,
      caller: body.caller || "viktor",
    });

    if (!validation.valid) {
      return NextResponse.json({
        ok: false, blocked: true, validation,
        message: validation.summary,
      }, { status: 422 });
    }
    if (isDryRun) {
      return NextResponse.json({
        ok: true, dry_run: true, validation,
        message: validation.summary,
      });
    }

    const result = await createQBOBillPayment(bpPayload);

    if (!result) {
      return NextResponse.json({ error: "QBO bill payment creation failed" }, { status: 500 });
    }

    const data = (result as Record<string, unknown>).BillPayment || result;
    return NextResponse.json({
      ok: true,
      bill_payment: data,
      validation: { issues: validation.issues, summary: validation.summary },
    });
  } catch (error) {
    console.error("[qbo/bill-payment] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Bill payment creation failed" }, { status: 500 });
  }
}

/**
 * DELETE /api/ops/qbo/bill-payment — Void a bill payment
 *
 * Body: { id, sync_token }
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

    const result = await voidQBOBillPayment(body.id, body.sync_token);

    if (!result) {
      return NextResponse.json(
        { error: `Failed to void bill payment ${body.id}` },
        { status: 500 },
      );
    }

    const data = (result as Record<string, unknown>).BillPayment || result;
    return NextResponse.json({ ok: true, voided: true, bill_payment: data });
  } catch (error) {
    console.error("[qbo/bill-payment] DELETE failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Bill payment void failed" }, { status: 500 });
  }
}
