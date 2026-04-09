/**
 * GET   /api/ops/qbo/estimate — List estimates or fetch by ID
 * POST  /api/ops/qbo/estimate — Create an estimate (Sales Order)
 * PATCH /api/ops/qbo/estimate — Update an estimate (sparse)
 *
 * GET query params: ?id=<estimate_id> | ?start_date=&end_date=
 *
 * POST body: {
 *   customer_id,           // required — QBO customer ID
 *   customer_name?,        // display name
 *   lines: [{              // required
 *     item_id,             // QBO Item ID
 *     item_name?,
 *     qty?,
 *     unit_price?,
 *     amount,              // line total
 *     description?
 *   }],
 *   date?,                 // transaction date
 *   expiration_date?,      // estimate expiration
 *   ref_number?,           // DocNumber
 *   memo?,                 // private note
 *   customer_memo?,        // visible to customer
 *   email?,                // BillEmail
 *   status?                // "Pending" | "Accepted" | "Closed" | "Rejected"
 * }
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  createQBOEstimate,
  getQBOEstimate,
  getQBOEstimates,
  updateQBOEstimate,
} from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineInput = {
  item_id: string;
  item_name?: string;
  qty?: number;
  unit_price?: number;
  amount: number;
  description?: string;
};

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const est = await getQBOEstimate(id);
    if (!est) {
      return NextResponse.json({ error: `Estimate ${id} not found` }, { status: 404 });
    }
    const data = (est as Record<string, unknown>).Estimate || est;
    return NextResponse.json({ ok: true, estimate: data });
  }

  const startDate = url.searchParams.get("start_date") || undefined;
  const endDate = url.searchParams.get("end_date") || undefined;

  const estimates = await getQBOEstimates(startDate, endDate);
  return NextResponse.json({ ok: true, count: estimates.length, estimates });
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.customer_id) {
      return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
    }
    if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: "lines array is required" }, { status: 400 });
    }

    const payload: Parameters<typeof createQBOEstimate>[0] = {
      CustomerRef: {
        value: body.customer_id,
        ...(body.customer_name ? { name: body.customer_name } : {}),
      },
      Line: (body.lines as LineInput[]).map((l) => ({
        Amount: l.amount,
        DetailType: "SalesItemLineDetail" as const,
        SalesItemLineDetail: {
          ItemRef: { value: l.item_id, ...(l.item_name ? { name: l.item_name } : {}) },
          ...(l.qty !== undefined ? { Qty: l.qty } : {}),
          ...(l.unit_price !== undefined ? { UnitPrice: l.unit_price } : {}),
        },
        ...(l.description ? { Description: l.description } : {}),
      })),
      ...(body.date ? { TxnDate: body.date } : {}),
      ...(body.expiration_date ? { ExpirationDate: body.expiration_date } : {}),
      ...(body.ref_number ? { DocNumber: body.ref_number } : {}),
      ...(body.memo ? { PrivateNote: body.memo } : {}),
      ...(body.customer_memo ? { CustomerMemo: { value: body.customer_memo } } : {}),
      ...(body.email ? { BillEmail: { Address: body.email } } : {}),
      ...(body.status ? { TxnStatus: body.status } : {}),
    };

    const result = await createQBOEstimate(payload);

    if (!result) {
      return NextResponse.json(
        { error: "QBO estimate creation failed" },
        { status: 500 },
      );
    }

    const data = (result as Record<string, unknown>).Estimate || result;
    const est = data as Record<string, unknown>;

    return NextResponse.json({
      ok: true,
      estimate: {
        Id: est.Id,
        DocNumber: est.DocNumber,
        TxnDate: est.TxnDate,
        ExpirationDate: est.ExpirationDate,
        TotalAmt: est.TotalAmt,
        TxnStatus: est.TxnStatus,
        CustomerRef: est.CustomerRef,
        SyncToken: est.SyncToken,
        Line: est.Line,
      },
      message: `Created estimate${est.DocNumber ? ` #${est.DocNumber}` : ""} for $${est.TotalAmt} — ID: ${est.Id}`,
    });
  } catch (error) {
    console.error("[qbo/estimate] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Estimate creation failed" },
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

    if (body.status !== undefined) payload.TxnStatus = body.status;
    if (body.memo !== undefined) payload.PrivateNote = body.memo;
    if (body.expiration_date !== undefined) payload.ExpirationDate = body.expiration_date;
    if (body.ref_number !== undefined) payload.DocNumber = body.ref_number;

    const result = await updateQBOEstimate(payload);

    if (!result) {
      return NextResponse.json(
        { error: "QBO estimate update failed" },
        { status: 500 },
      );
    }

    const data = (result as Record<string, unknown>).Estimate || result;
    return NextResponse.json({ ok: true, estimate: data, message: `Updated estimate ID ${body.id}` });
  } catch (error) {
    console.error("[qbo/estimate] PATCH failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Estimate update failed" },
      { status: 500 },
    );
  }
}
