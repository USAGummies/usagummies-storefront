/**
 * POST /api/ops/qbo/validate — Validate a QBO write without executing
 *
 * This IS the dry run mode. Viktor sends the same payload it would send
 * to any QBO write endpoint, plus entity_type. Gets back validation
 * result without touching QBO.
 *
 * Body: {
 *   entity_type: "invoice" | "bill" | "payment" | "purchaseorder" | "estimate" | etc.
 *   payload: { ...QBO payload... }
 *   caller?: "viktor" | "manual"
 * }
 *
 * Returns: { valid, dry_run: true, issues: [...], summary }
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { validateQBOWrite, logQBOAudit } from "@/lib/ops/qbo-guardrails";
import type { QBOEntityType } from "@/lib/ops/qbo-guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.entity_type || !body.payload) {
      return NextResponse.json(
        { error: "Required: entity_type and payload" },
        { status: 400 },
      );
    }

    const result = await validateQBOWrite(
      body.entity_type as QBOEntityType,
      body.payload as Record<string, unknown>,
      { dry_run: true, caller: body.caller || "viktor" },
    );

    // Log the dry run attempt
    await logQBOAudit({
      entity_type: body.entity_type,
      action: "create",
      endpoint: `/api/ops/qbo/${body.entity_type}`,
      amount: result.amount,
      vendor_or_customer: (body.payload as Record<string, unknown>).VendorRef
        ? `vendor:${((body.payload as Record<string, unknown>).VendorRef as Record<string, unknown>)?.value}`
        : (body.payload as Record<string, unknown>).CustomerRef
          ? `customer:${((body.payload as Record<string, unknown>).CustomerRef as Record<string, unknown>)?.value}`
          : undefined,
      ref_number: (body.payload as Record<string, unknown>).DocNumber as string | undefined,
      dry_run: true,
      validation_passed: result.valid,
      issues: result.issues,
      caller: body.caller || "viktor",
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Validation failed" },
      { status: 500 },
    );
  }
}
