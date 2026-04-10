/**
 * GET    /api/ops/qbo/purchaseorder — List POs (optional date filters)
 * POST   /api/ops/qbo/purchaseorder — Create a Purchase Order
 * PATCH  /api/ops/qbo/purchaseorder — Update an existing PO (sparse)
 * DELETE /api/ops/qbo/purchaseorder — Delete a Purchase Order
 *
 * GET query params: ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&id=<po_id>
 *   - With id: returns a single PO by ID
 *   - Without id: returns list filtered by date range
 *
 * POST body: {
 *   vendor_id,             // required — QBO vendor ID
 *   lines: [{              // required — at least one line
 *     item_id,             // QBO Item ID
 *     item_name?,          // display name
 *     qty?,                // quantity
 *     unit_price?,         // price per unit
 *     amount,              // line total
 *     description?,        // line memo
 *     customer_id?         // optional customer/project link
 *   }],
 *   date?,                 // transaction date
 *   due_date?,             // expected delivery/due
 *   ref_number?,           // PO number (DocNumber)
 *   memo?,                 // header memo
 *   vendor_message?,       // message to vendor (prints on PO)
 *   ap_account_id?,        // AP account override
 *   ship_to?: { line1, city, state, zip } | { Line1, City, CountrySubDivisionCode, PostalCode },
 *   ship_via?              // shipping method / carrier (free text, auto-creates in QBO)
 *   // Note: vendor email is set via PUT /api/ops/qbo/vendor, not on the PO
 * }
 *
 * DELETE body: { id, sync_token }
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  createQBOPurchaseOrder,
  deleteQBOPurchaseOrder,
  getQBOPurchaseOrder,
  getQBOPurchaseOrders,
  updateQBOPurchaseOrder,
} from "@/lib/ops/qbo-client";
import { validateQBOWrite, logQBOAudit } from "@/lib/ops/qbo-guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineInput = {
  item_id: string;
  item_name?: string;
  qty?: number;
  quantity?: number; // alias for qty (Viktor sends this)
  unit_price?: number;
  amount?: number; // optional — computed from qty * unit_price if missing
  description?: string;
  customer_id?: string;
};

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const po = await getQBOPurchaseOrder(id);
    if (!po) {
      return NextResponse.json({ error: `PO ${id} not found` }, { status: 404 });
    }
    const data = (po as Record<string, unknown>).PurchaseOrder || po;
    return NextResponse.json({ ok: true, purchase_order: data });
  }

  const startDate = url.searchParams.get("start_date") || undefined;
  const endDate = url.searchParams.get("end_date") || undefined;

  const pos = await getQBOPurchaseOrders(startDate, endDate);
  return NextResponse.json({ ok: true, count: pos.length, purchase_orders: pos });
}

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

    const payload: Parameters<typeof createQBOPurchaseOrder>[0] = {
      VendorRef: { value: body.vendor_id },
      Line: (body.lines as LineInput[]).map((l) => {
        const qty = l.qty ?? l.quantity; // accept both qty and quantity
        const unitPrice = l.unit_price;
        const amount = l.amount ?? (qty && unitPrice ? Number((qty * unitPrice).toFixed(2)) : 0);

        return {
          Amount: amount,
          DetailType: "ItemBasedExpenseLineDetail" as const,
          ItemBasedExpenseLineDetail: {
            ItemRef: { value: l.item_id, ...(l.item_name ? { name: l.item_name } : {}) },
            ...(qty !== undefined ? { Qty: qty } : {}),
            ...(unitPrice !== undefined ? { UnitPrice: unitPrice } : {}),
            ...(l.customer_id ? { CustomerRef: { value: l.customer_id } } : {}),
          },
          ...(l.description ? { Description: l.description } : {}),
        };
      }),
      ...(body.date ? { TxnDate: body.date } : {}),
      ...(body.due_date ? { DueDate: body.due_date } : {}),
      ...(body.ref_number ? { DocNumber: body.ref_number } : {}),
      ...(body.memo ? { Memo: body.memo } : {}),
      ...(body.ap_account_id ? { APAccountRef: { value: body.ap_account_id } } : {}),
      ...(body.ship_to ? {
        ShipAddr: {
          Line1: body.ship_to.line1 || body.ship_to.Line1,
          City: body.ship_to.city || body.ship_to.City,
          CountrySubDivisionCode: body.ship_to.state || body.ship_to.CountrySubDivisionCode,
          PostalCode: body.ship_to.zip || body.ship_to.PostalCode,
        },
      } : {}),
      ...(body.ship_via ? { ShipMethodRef: { value: body.ship_via, name: body.ship_via } } : {}),
      ...(body.vendor_message ? { CustomerMemo: { value: body.vendor_message } } : {}),
      // Note: vendor_email is set on the Vendor record (PUT /vendor), not on the PO
    };

    // ── GUARDRAIL: Validate before writing ──
    const isDryRun = body.dry_run === true;
    const validation = await validateQBOWrite(
      "purchaseorder",
      payload as unknown as Record<string, unknown>,
      { dry_run: isDryRun, caller: body.caller || "viktor" },
    );

    // Log the attempt regardless
    await logQBOAudit({
      entity_type: "purchaseorder",
      action: "create",
      endpoint: "/api/ops/qbo/purchaseorder",
      amount: validation.amount,
      vendor_or_customer: `vendor:${body.vendor_id}`,
      ref_number: body.ref_number,
      dry_run: isDryRun,
      validation_passed: validation.valid,
      issues: validation.issues,
      caller: body.caller || "viktor",
    });

    // Block if validation fails or dry run
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

    const result = await createQBOPurchaseOrder(payload);

    if (!result) {
      return NextResponse.json(
        { error: "QBO purchase order creation failed — check connection and field values" },
        { status: 500 },
      );
    }

    const data = (result as Record<string, unknown>).PurchaseOrder || result;
    const po = data as Record<string, unknown>;

    // Log successful write with result ID
    await logQBOAudit({
      entity_type: "purchaseorder",
      action: "create",
      endpoint: "/api/ops/qbo/purchaseorder",
      amount: validation.amount,
      vendor_or_customer: `vendor:${body.vendor_id}`,
      ref_number: po.DocNumber as string | undefined,
      dry_run: false,
      validation_passed: true,
      issues: validation.issues,
      result_id: po.Id as string | undefined,
      caller: body.caller || "viktor",
    });

    return NextResponse.json({
      ok: true,
      purchase_order: {
        Id: po.Id,
        DocNumber: po.DocNumber,
        TxnDate: po.TxnDate,
        DueDate: po.DueDate,
        TotalAmt: po.TotalAmt,
        VendorRef: po.VendorRef,
        POStatus: po.POStatus,
        SyncToken: po.SyncToken,
        Line: po.Line,
        ShipAddr: po.ShipAddr,
        ShipMethodRef: po.ShipMethodRef,
      },
      validation: {
        issues: validation.issues,
        summary: validation.summary,
      },
      message: `Created PO${po.DocNumber ? ` #${po.DocNumber}` : ""} for $${po.TotalAmt} — ID: ${po.Id}`,
    });
  } catch (error) {
    console.error("[qbo/purchaseorder] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PO creation failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    const id = body.id || body.Id;
    const syncToken = body.sync_token ?? body.SyncToken ?? body.sync_Token;
    if (!id || syncToken === undefined) {
      return NextResponse.json(
        { error: "id and sync_token are required" },
        { status: 400 },
      );
    }

    const payload: Record<string, unknown> = {
      Id: id,
      SyncToken: String(syncToken),
      sparse: true,
    };

    // Accept both snake_case and PascalCase for all fields
    const memo = body.memo ?? body.Memo;
    const dueDate = body.due_date ?? body.DueDate;
    const txnDate = body.date ?? body.TxnDate;
    const refNumber = body.ref_number ?? body.DocNumber;
    const poStatus = body.po_status ?? body.POStatus;
    const shipVia = body.ship_via ?? body.ShipMethodRef;
    const vendorMessage = body.vendor_message ?? body.CustomerMemo;

    if (memo !== undefined) payload.Memo = memo;
    if (dueDate !== undefined) payload.DueDate = dueDate;
    if (txnDate !== undefined) payload.TxnDate = txnDate;
    if (refNumber !== undefined) payload.DocNumber = refNumber;
    if (poStatus !== undefined) payload.POStatus = poStatus; // "Open" or "Closed"
    if (shipVia !== undefined) {
      const name = typeof shipVia === "string" ? shipVia : shipVia?.value || shipVia?.name;
      payload.ShipMethodRef = { value: name, name };
    }
    if (vendorMessage !== undefined) {
      const msg = typeof vendorMessage === "string" ? vendorMessage : vendorMessage?.value;
      payload.CustomerMemo = { value: msg };
    }
    // Note: vendor_email is set on the Vendor record (PUT /api/ops/qbo/vendor), not on the PO itself
    if (body.ship_to !== undefined) {
      const s = body.ship_to;
      payload.ShipAddr = {
        // Accept both snake_case (line1, city, state, zip) and QBO PascalCase (Line1, City, etc.)
        Line1: s.line1 || s.Line1,
        City: s.city || s.City,
        CountrySubDivisionCode: s.state || s.CountrySubDivisionCode,
        PostalCode: s.zip || s.PostalCode,
      };
    }
    if (body.lines && Array.isArray(body.lines) && body.lines.length > 0) {
      payload.Line = (body.lines as LineInput[]).map((l) => {
        const qty = l.qty ?? l.quantity;
        const unitPrice = l.unit_price;
        const amount = l.amount ?? (qty && unitPrice ? Number((qty * unitPrice).toFixed(2)) : 0);
        return {
          Amount: amount,
          DetailType: "ItemBasedExpenseLineDetail" as const,
          ItemBasedExpenseLineDetail: {
            ItemRef: { value: l.item_id, ...(l.item_name ? { name: l.item_name } : {}) },
            ...(qty !== undefined ? { Qty: qty } : {}),
            ...(unitPrice !== undefined ? { UnitPrice: unitPrice } : {}),
            ...(l.customer_id ? { CustomerRef: { value: l.customer_id } } : {}),
          },
          ...(l.description ? { Description: l.description } : {}),
        };
      });
      // When updating lines, must NOT use sparse — QBO requires full payload for line replacement
      payload.sparse = false;
      // Need VendorRef for non-sparse update — fetch existing PO to get it
      const existing = await getQBOPurchaseOrder(body.id);
      if (existing) {
        const poData = (existing as Record<string, unknown>).PurchaseOrder || existing;
        payload.VendorRef = (poData as Record<string, unknown>).VendorRef;
      }
    }

    const result = await updateQBOPurchaseOrder(payload);

    if (!result) {
      return NextResponse.json(
        { error: "QBO PO update failed — check id and sync_token" },
        { status: 500 },
      );
    }

    const data = (result as Record<string, unknown>).PurchaseOrder || result;
    const po = data as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      purchase_order: data,
      message: `Updated PO ID ${id}`,
      _debug: {
        sent_fields: Object.keys(payload).filter((k) => k !== "Id" && k !== "SyncToken" && k !== "sparse"),
        sync_token_sent: String(syncToken),
        sync_token_returned: po.SyncToken,
        due_date_returned: po.DueDate ?? null,
      },
    });
  } catch (error) {
    console.error("[qbo/purchaseorder] PATCH failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PO update failed" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/ops/qbo/purchaseorder — Delete a Purchase Order
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

    const result = await deleteQBOPurchaseOrder(body.id, body.sync_token);

    if (!result) {
      return NextResponse.json(
        { error: `Failed to delete PO ${body.id}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, deleted: true, id: body.id });
  } catch (error) {
    console.error("[qbo/purchaseorder] DELETE failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PO deletion failed" },
      { status: 500 },
    );
  }
}
