import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOTransfer } from "@/lib/ops/qbo-client";
import { validateQBOWrite, logQBOAudit } from "@/lib/ops/qbo-guardrails";

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

    const transferPayload = {
      FromAccountRef: { value: body.from_account_id },
      ToAccountRef: { value: body.to_account_id },
      Amount: body.amount,
      TxnDate: body.date,
      PrivateNote: body.memo,
    };

    // ── GUARDRAIL: Validate before writing ──
    const isDryRun = body.dry_run === true;
    const validation = await validateQBOWrite(
      "transfer",
      transferPayload as unknown as Record<string, unknown>,
      { dry_run: isDryRun, caller: body.caller || "viktor" },
    );

    await logQBOAudit({
      entity_type: "transfer",
      action: "create",
      endpoint: "/api/ops/qbo/transfer",
      amount: validation.amount,
      vendor_or_customer: undefined,
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

    const result = await createQBOTransfer(transferPayload);

    if (!result) {
      return NextResponse.json({ error: "QBO transfer creation failed" }, { status: 500 });
    }

    const data = (result as Record<string, unknown>).Transfer || result;
    return NextResponse.json({
      ok: true, transfer: data,
      validation: { issues: validation.issues, summary: validation.summary },
    });
  } catch (error) {
    console.error("[qbo/transfer] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Transfer creation failed" }, { status: 500 });
  }
}
