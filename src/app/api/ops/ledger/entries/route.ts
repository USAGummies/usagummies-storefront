import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listEntries, upsertEntry, reviewEntry } from "@/lib/ops/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const type = url.searchParams.get("type") || undefined;
    const source = url.searchParams.get("source") || undefined;

    const entries = await listEntries({ status, type, source });
    return NextResponse.json({ ok: true, entries, count: entries.length });
  } catch (error) {
    console.error("[ledger/entries] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list entries" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.type || !body.description || body.amount === undefined || !body.debit_account || !body.credit_account || !body.source) {
      return NextResponse.json(
        { error: "Required: id, type, description, amount, debit_account, credit_account, source" },
        { status: 400 }
      );
    }

    const entry = await upsertEntry({
      id: body.id,
      type: body.type,
      description: body.description,
      amount: body.amount,
      debit_account: body.debit_account,
      credit_account: body.credit_account,
      date: body.date || new Date().toISOString().split("T")[0],
      status: body.status || "draft",
      reviewed_by: body.reviewed_by,
      reviewed_at: body.reviewed_at,
      source: body.source,
      reference: body.reference,
      notes: body.notes,
      created_at: body.created_at || new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    console.error("[ledger/entries] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to save entry" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.status || !body.reviewed_by) {
      return NextResponse.json(
        { error: "Required: id, status (approved|rejected), reviewed_by" },
        { status: 400 }
      );
    }

    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json(
        { error: "status must be 'approved' or 'rejected'" },
        { status: 400 }
      );
    }

    const entry = await reviewEntry(body.id, body.status, body.reviewed_by);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    console.error("[ledger/entries] PATCH failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to review entry" }, { status: 500 });
  }
}
