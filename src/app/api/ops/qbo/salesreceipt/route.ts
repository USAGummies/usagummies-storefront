/**
 * Sales Receipt CRUD — /api/ops/qbo/salesreceipt
 *
 * Sales Receipts record transactions where payment is received at point of sale.
 * For USA Gummies, these decompose marketplace settlement deposits into:
 *   - Gross revenue → 400015.xx (Revenue by channel)
 *   - Marketplace fees → 500040.xx (MSF by channel, COGS)
 *   - Refunds/returns → 400025.xx (Returns by channel)
 *   - Advertising → 660020 (Marketing, OVERHEAD — never COGS)
 *   - Net deposit → matches bank feed
 *
 * GET    ?id=X        — Get single sales receipt
 * GET    ?start_date=&end_date=  — List sales receipts by date range
 * POST               — Create a sales receipt
 * DELETE              — Delete a sales receipt (id + sync_token)
 *
 * POST body: {
 *   customer_id,           // required — QBO customer ID (e.g., "Amazon", "Shopify")
 *   customer_name?,        // display name (for resolving if customer_id not known)
 *   lines: [{              // required — at least one line
 *     item_id,             // QBO Item ID
 *     item_name?,          // display name
 *     qty?,                // quantity (default 1)
 *     unit_price?,         // price per unit
 *     amount,              // line total (computed from qty * unit_price if missing)
 *     description?,        // line memo (e.g., "Amazon referral fees - week of 2026-04-07")
 *   }],
 *   date?,                 // transaction date (YYYY-MM-DD)
 *   ref_number?,           // DocNumber (e.g., settlement report ID)
 *   memo?,                 // private note
 *   deposit_to_account_id?, // bank account to deposit to
 *   payment_method_id?,    // payment method ref
 *   customer_memo?,        // memo visible to customer
 *   dry_run?,              // validate without creating
 *   caller?                // "viktor" or "manual"
 * }
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  createQBOSalesReceipt,
  deleteQBOSalesReceipt,
  getQBOSalesReceipt,
  getQBOSalesReceipts,
} from "@/lib/ops/qbo-client";
import { validateQBOWrite, logQBOAudit } from "@/lib/ops/qbo-guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineInput = {
  item_id: string;
  item_name?: string;
  qty?: number;
  quantity?: number;
  unit_price?: number;
  amount?: number;
  description?: string;
};

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const sr = await getQBOSalesReceipt(id);
    if (!sr) {
      return NextResponse.json({ error: `Sales Receipt ${id} not found` }, { status: 404 });
    }
    const data = (sr as Record<string, unknown>).SalesReceipt || sr;
    return NextResponse.json({ ok: true, sales_receipt: data });
  }

  const startDate = url.searchParams.get("start_date") || undefined;
  const endDate = url.searchParams.get("end_date") || undefined;

  const receipts = await getQBOSalesReceipts(startDate, endDate);
  return NextResponse.json({ ok: true, count: receipts.length, sales_receipts: receipts });
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.customer_id && !body.customer_name) {
      return NextResponse.json(
        { error: "customer_id or customer_name is required" },
        { status: 400 },
      );
    }
    if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json(
        { error: "lines array is required with at least one line item" },
        { status: 400 },
      );
    }

    const payload: Parameters<typeof createQBOSalesReceipt>[0] = {
      CustomerRef: {
        value: body.customer_id || "",
        ...(body.customer_name ? { name: body.customer_name } : {}),
      },
      Line: (body.lines as LineInput[]).map((l) => {
        const qty = l.qty ?? l.quantity ?? 1;
        const unitPrice = l.unit_price;
        const amount = l.amount ?? (qty && unitPrice ? Number((qty * unitPrice).toFixed(2)) : 0);

        return {
          Amount: amount,
          DetailType: "SalesItemLineDetail" as const,
          SalesItemLineDetail: {
            ItemRef: {
              value: l.item_id,
              ...(l.item_name ? { name: l.item_name } : {}),
            },
            ...(qty !== undefined ? { Qty: qty } : {}),
            ...(unitPrice !== undefined ? { UnitPrice: unitPrice } : {}),
          },
          ...(l.description ? { Description: l.description } : {}),
        };
      }),
      ...(body.date ? { TxnDate: body.date } : {}),
      ...(body.ref_number ? { DocNumber: body.ref_number } : {}),
      ...(body.memo ? { PrivateNote: body.memo } : {}),
      ...(body.deposit_to_account_id
        ? { DepositToAccountRef: { value: body.deposit_to_account_id } }
        : {}),
      ...(body.payment_method_id
        ? { PaymentMethodRef: { value: body.payment_method_id } }
        : {}),
      ...(body.customer_memo
        ? { CustomerMemo: { value: body.customer_memo } }
        : {}),
    };

    // ── GUARDRAIL: Validate before writing ──
    const isDryRun = body.dry_run === true;
    const validation = await validateQBOWrite(
      "salesreceipt",
      payload as unknown as Record<string, unknown>,
      { dry_run: isDryRun, caller: body.caller || "viktor" },
    );

    // Log the attempt
    await logQBOAudit({
      entity_type: "salesreceipt",
      action: "create",
      endpoint: "/api/ops/qbo/salesreceipt",
      amount: validation.amount,
      vendor_or_customer: `customer:${body.customer_id || body.customer_name}`,
      ref_number: body.ref_number,
      dry_run: isDryRun,
      validation_passed: validation.valid,
      issues: validation.issues,
      caller: body.caller || "viktor",
    });

    if (!validation.valid) {
      return NextResponse.json({
        ok: false,
        blocked: true,
        validation,
        message: validation.summary,
      }, { status: 422 });
    }
    if (isDryRun) {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        validation,
        message: validation.summary,
      });
    }

    const result = await createQBOSalesReceipt(payload);

    if (!result) {
      return NextResponse.json(
        { error: "QBO sales receipt creation failed — check connection and field values" },
        { status: 500 },
      );
    }

    const data = (result as Record<string, unknown>).SalesReceipt || result;
    const sr = data as Record<string, unknown>;

    // Log successful write
    await logQBOAudit({
      entity_type: "salesreceipt",
      action: "create",
      endpoint: "/api/ops/qbo/salesreceipt",
      amount: validation.amount,
      vendor_or_customer: `customer:${body.customer_id || body.customer_name}`,
      ref_number: sr.DocNumber as string | undefined,
      dry_run: false,
      validation_passed: true,
      issues: validation.issues,
      result_id: sr.Id as string | undefined,
      caller: body.caller || "viktor",
    });

    return NextResponse.json({
      ok: true,
      sales_receipt: {
        Id: sr.Id,
        DocNumber: sr.DocNumber,
        TxnDate: sr.TxnDate,
        TotalAmt: sr.TotalAmt,
        CustomerRef: sr.CustomerRef,
        DepositToAccountRef: sr.DepositToAccountRef,
        SyncToken: sr.SyncToken,
        Line: sr.Line,
      },
      validation: {
        issues: validation.issues,
        summary: validation.summary,
      },
      message: `Created Sales Receipt${sr.DocNumber ? ` #${sr.DocNumber}` : ""} for $${sr.TotalAmt} — ID: ${sr.Id}`,
    });
  } catch (error) {
    console.error("[qbo/salesreceipt] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sales receipt creation failed" },
      { status: 500 },
    );
  }
}

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

    const result = await deleteQBOSalesReceipt(body.id, body.sync_token);

    if (!result) {
      return NextResponse.json(
        { error: `Failed to delete Sales Receipt ${body.id}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, deleted: true, id: body.id });
  } catch (error) {
    console.error("[qbo/salesreceipt] DELETE failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sales receipt deletion failed" },
      { status: 500 },
    );
  }
}
