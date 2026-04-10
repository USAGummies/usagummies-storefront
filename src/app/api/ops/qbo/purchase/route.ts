import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOPurchase } from "@/lib/ops/qbo-client";
import { validateQBOWrite, logQBOAudit } from "@/lib/ops/qbo-guardrails";

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

    const purchasePayload = {
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
    };

    // ── GUARDRAIL: Validate before writing ──
    const isDryRun = body.dry_run === true;
    const validation = await validateQBOWrite(
      "purchase",
      purchasePayload as unknown as Record<string, unknown>,
      { dry_run: isDryRun, caller: body.caller || "viktor" },
    );

    await logQBOAudit({
      entity_type: "purchase",
      action: "create",
      endpoint: "/api/ops/qbo/purchase",
      amount: validation.amount,
      vendor_or_customer: body.vendor_id ? `vendor:${body.vendor_id}` : undefined,
      ref_number: body.ref_number,
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

    const result = await createQBOPurchase(purchasePayload);

    if (!result) {
      return NextResponse.json({ error: "QBO purchase creation failed" }, { status: 500 });
    }

    const data = (result as Record<string, unknown>).Purchase || result;
    return NextResponse.json({
      ok: true, purchase: data,
      validation: { issues: validation.issues, summary: validation.summary },
    });
  } catch (error) {
    console.error("[qbo/purchase] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Purchase creation failed" }, { status: 500 });
  }
}
