import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBODeposit } from "@/lib/ops/qbo-client";
import { validateQBOWrite, logQBOAudit } from "@/lib/ops/qbo-guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.deposit_to_account_id) {
      return NextResponse.json({ error: "deposit_to_account_id is required" }, { status: 400 });
    }
    if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: "lines array is required" }, { status: 400 });
    }

    const depositPayload = {
      DepositToAccountRef: { value: body.deposit_to_account_id },
      TxnDate: body.date,
      PrivateNote: body.memo,
      Line: body.lines.map((l: { amount: number; account_id: string; description?: string; entity_id?: string; entity_type?: string }) => ({
        Amount: l.amount,
        DetailType: "DepositLineDetail" as const,
        DepositLineDetail: {
          AccountRef: { value: l.account_id },
          ...(l.entity_id ? { Entity: { value: l.entity_id, type: l.entity_type } } : {}),
        },
        Description: l.description,
      })),
    };

    // ── GUARDRAIL: Validate before writing ──
    const isDryRun = body.dry_run === true;
    const validation = await validateQBOWrite(
      "deposit",
      depositPayload as unknown as Record<string, unknown>,
      { dry_run: isDryRun, caller: body.caller || "viktor" },
    );

    await logQBOAudit({
      entity_type: "deposit",
      action: "create",
      endpoint: "/api/ops/qbo/deposit",
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

    const result = await createQBODeposit(depositPayload);

    if (!result) {
      return NextResponse.json({ error: "QBO deposit creation failed" }, { status: 500 });
    }

    const data = (result as Record<string, unknown>).Deposit || result;
    return NextResponse.json({
      ok: true, deposit: data,
      validation: { issues: validation.issues, summary: validation.summary },
    });
  } catch (error) {
    console.error("[qbo/deposit] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Deposit creation failed" }, { status: 500 });
  }
}
