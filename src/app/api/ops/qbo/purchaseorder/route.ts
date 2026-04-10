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

    const result = await createQBOPurchaseOrder(payload);

    if (!result) {
      return NextResponse.json(
        { error: "QBO purchase order creation failed — check connection and field values" },
        { status: 500 },
      );
    }

    const data = (result as Record<string, unknown>).PurchaseOrder || result;
    const po = data as Record<string, unknown>;

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

    if (!body.id || body.sync_token === undefined) {
      return NextResponse.json(
        { error: "id and sync_token are required" },
        { status: 400 },
      );
    }

    const payload: Record<string, unknown> = {
      Id: body.id,
      SyncToken: body.sync_token,
      sparse: true,
    };

    if (body.memo !== undefined) payload.Memo = body.memo;
    if (body.due_date !== undefined) payload.DueDate = body.due_date;
    if (body.date !== undefined) payload.TxnDate = body.date;
    if (body.ref_number !== undefined) payload.DocNumber = body.ref_number;
    if (body.po_status !== undefined) payload.POStatus = body.po_status; // "Open" or "Closed"
    if (body.ship_via !== undefined) payload.ShipMethodRef = { value: body.ship_via, name: body.ship_via };
    if (body.vendor_message !== undefined) payload.CustomerMemo = { value: body.vendor_message };
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
    return NextResponse.json({ ok: true, purchase_order: data, message: `Updated PO ID ${body.id}` });
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
