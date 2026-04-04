import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOTransfer } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.from_account_id) {
      return NextResponse.json({ error: "from_account_id is required" }, { status: 400 });
    }
    if (!body.to_account_id) {
      return NextResponse.json({ error: "to_account_id is required" }, { status: 400 });
    }
    if (!body.amount || typeof body.amount !== "number") {
      return NextResponse.json({ error: "amount (number) is required" }, { status: 400 });
    }

    const result = await createQBOTransfer({
      FromAccountRef: { value: body.from_account_id },
      ToAccountRef: { value: body.to_account_id },
      Amount: body.amount,
      TxnDate: body.date,
      PrivateNote: body.memo,
    });

    if (!result) {
      return NextResponse.json({ error: "QBO transfer creation failed" }, { status: 500 });
    }

    const data = (result as Record<string, unknown>).Transfer || result;
    return NextResponse.json({ ok: true, transfer: data });
  } catch (error) {
    console.error("[qbo/transfer] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Transfer creation failed" }, { status: 500 });
  }
}
