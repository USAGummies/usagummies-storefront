import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOJournalEntry } from "@/lib/ops/qbo-client";
import { validateQBOWrite, logQBOAudit } from "@/lib/ops/qbo-guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: "lines array is required" }, { status: 400 });
    }

    // Validate each line has required fields
    for (const line of body.lines) {
      if (!line.posting_type || !["Debit", "Credit"].includes(line.posting_type)) {
        return NextResponse.json(
          { error: "Each line must have posting_type: 'Debit' or 'Credit'" },
          { status: 400 },
        );
      }
      if (!line.account_id) {
        return NextResponse.json(
          { error: "Each line must have account_id" },
          { status: 400 },
        );
      }
      if (typeof line.amount !== "number" || line.amount <= 0) {
        return NextResponse.json(
          { error: "Each line must have a positive numeric amount" },
          { status: 400 },
        );
      }
    }

    const jePayload = {
      TxnDate: body.date,
      PrivateNote: body.memo,
      Line: body.lines.map(
        (l: {
          amount: number;
          posting_type: "Debit" | "Credit";
          account_id: string;
          account_name?: string;
          description?: string;
        }) => ({
          Amount: l.amount,
          DetailType: "JournalEntryLineDetail" as const,
          Description: l.description,
          JournalEntryLineDetail: {
            PostingType: l.posting_type,
            AccountRef: { value: l.account_id, name: l.account_name },
          },
        }),
      ),
    };

    // ── GUARDRAIL: Validate before writing ──
    const isDryRun = body.dry_run === true;
    const validation = await validateQBOWrite(
      "journal-entry",
      jePayload as unknown as Record<string, unknown>,
      { dry_run: isDryRun, caller: body.caller || "viktor" },
    );

    await logQBOAudit({
      entity_type: "journal-entry",
      action: "create",
      endpoint: "/api/ops/qbo/journal-entry",
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

    const result = await createQBOJournalEntry(jePayload);

    if (!result) {
      return NextResponse.json(
        { error: "QBO journal entry creation failed" },
        { status: 500 },
      );
    }

    const data =
      (result as Record<string, unknown>).JournalEntry || result;
    return NextResponse.json({
      ok: true, journal_entry: data,
      validation: { issues: validation.issues, summary: validation.summary },
    });
  } catch (error) {
    console.error(
      "[qbo/journal-entry] POST failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Journal entry creation failed" },
      { status: 500 },
    );
  }
}
