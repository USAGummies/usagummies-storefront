import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOBill, deleteQBOBill } from "@/lib/ops/qbo-client";

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

    const result = await createQBOBill({
      VendorRef: { value: body.vendor_id },
      DueDate: body.due_date,
      DocNumber: body.ref_number,
      TxnDate: body.date,
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
      return NextResponse.json({ error: "QBO bill creation failed" }, { status: 500 });
    }

    const data = (result as Record<string, unknown>).Bill || result;
    return NextResponse.json({ ok: true, bill: data });
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
