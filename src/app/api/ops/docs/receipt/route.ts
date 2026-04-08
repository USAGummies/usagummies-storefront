import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { processReceipt, listReceipts, getReceiptSummary } from "@/lib/ops/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const summary = url.searchParams.get("summary") === "true";
    if (summary) {
      const data = await getReceiptSummary();
      return NextResponse.json({ ok: true, ...data });
    }
    const vendor = url.searchParams.get("vendor") || undefined;
    const category = url.searchParams.get("category") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const receipts = await listReceipts({ vendor, category, limit });
    return NextResponse.json({ ok: true, receipts, count: receipts.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to list receipts" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.source_url || !body.source_channel || !body.vendor || !body.date || body.amount === undefined || !body.category) {
      return NextResponse.json({ error: "Required: source_url, source_channel, vendor, date, amount, category" }, { status: 400 });
    }
    const receipt = await processReceipt({
      source_url: body.source_url, source_channel: body.source_channel,
      vendor: body.vendor, date: body.date, amount: body.amount,
      payment_method: body.payment_method, category: body.category,
      subcategory: body.subcategory, mileage: body.mileage, notes: body.notes,
    });
    return NextResponse.json({ ok: true, receipt });
  } catch (error) {
    return NextResponse.json({ error: "Failed to process receipt" }, { status: 500 });
  }
}
