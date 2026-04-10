import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOBill, deleteQBOBill } from "@/lib/ops/qbo-client";
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
    if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: "lines array is required" }, { status: 400 });
    }

    const billPayload = {
      VendorRef: { value: body.vendor_id },
      DueDate: body.due_date,
      DocNumber: body.ref_number || body.doc_number,
      TxnDate: body.date || body.txn_date,
      ...(body.memo ? { PrivateNote: body.memo } : {}),
      Line: body.lines.map((l: {
        amount: number;
        expense_account_id?: string;
        account_id?: string; // alias for expense_account_id (Viktor sends this)
        item_id?: string;
        quantity?: number;
        unit_price?: number;
        description?: string;
      }) => {
        const accountId = l.expense_account_id || l.account_id;

        // If item_id is provided, use ItemBasedExpenseLineDetail
        if (l.item_id) {
          const qty = l.quantity ?? 1;
          const unitPrice = l.unit_price ?? l.amount;
          const lineAmount = l.amount ?? Number((qty * unitPrice).toFixed(2));
          return {
            Amount: lineAmount,
            DetailType: "ItemBasedExpenseLineDetail" as const,
            ItemBasedExpenseLineDetail: {
              ItemRef: { value: l.item_id },
              Qty: qty,
              UnitPrice: unitPrice,
              ...(accountId ? { AccountRef: { value: accountId } } : {}),
            },
            ...(l.description ? { Description: l.description } : {}),
          };
        }

        // Default: AccountBasedExpenseLineDetail
        return {
          Amount: l.amount,
          DetailType: "AccountBasedExpenseLineDetail" as const,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: accountId },
          },
          ...(l.description ? { Description: l.description } : {}),
        };
      }),
    };

    // ── GUARDRAIL: Validate before writing ──
    const isDryRun = body.dry_run === true;
    const validation = await validateQBOWrite(
      "bill",
      billPayload as unknown as Record<string, unknown>,
      { dry_run: isDryRun, caller: body.caller || "viktor" },
    );

    await logQBOAudit({
      entity_type: "bill",
      action: "create",
      endpoint: "/api/ops/qbo/bill",
      amount: validation.amount,
      vendor_or_customer: `vendor:${body.vendor_id}`,
      ref_number: body.ref_number || body.doc_number,
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

    const result = await createQBOBill(billPayload);

    if (!result) {
      return NextResponse.json({ error: "QBO bill creation failed" }, { status: 500 });
    }

    const data = (result as Record<string, unknown>).Bill || result;
    return NextResponse.json({
      ok: true,
      bill: data,
      validation: { issues: validation.issues, summary: validation.summary },
    });
  } catch (error) {
    console.error("[qbo/bill] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Bill creation failed" }, { status: 500 });
  }
}

/**
 * DELETE /api/ops/qbo/bill — Delete a bill
 *
 * Body: { id, sync_token }
 * Note: QBO bills can only be deleted, not voided.
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

    const result = await deleteQBOBill(body.id, body.sync_token);

    if (!result) {
      return NextResponse.json(
        { error: `Failed to delete bill ${body.id}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, deleted: true, id: body.id });
  } catch (error) {
    console.error("[qbo/bill] DELETE failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Bill deletion failed" }, { status: 500 });
  }
}
