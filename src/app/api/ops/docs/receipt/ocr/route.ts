/**
 * POST /api/ops/docs/receipt/ocr
 *
 * Phase 7 receipt OCR — attach a *suggestion* envelope to an
 * existing receipt for review by Rene/Ben. Prepare-for-review only:
 * this route never auto-promotes status, never writes to QBO,
 * never creates vendors, and never classifies a payment beyond
 * surfacing the literal hint.
 *
 * Body (one of two shapes):
 *   { receiptId, ocrText }      — server runs `extractReceiptFromText`
 *                                 and attaches the suggestion.
 *   { receiptId, suggestion }   — caller already ran extraction
 *                                 elsewhere (e.g. an external OCR
 *                                 provider) and passes the
 *                                 normalized envelope through. The
 *                                 envelope is validated via
 *                                 `isReceiptOcrSuggestion` before
 *                                 attachment.
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` rechecks (session OR
 *     CRON_SECRET) on every call.
 *   - **Read-only on QBO/HubSpot/Slack.** This route awaits only
 *     the in-repo extractor + KV attach. No QBO module, no
 *     HubSpot module, no email/Slack send is imported.
 *   - **Receipt status is preserved.** A receipt in `needs_review`
 *     stays in `needs_review` after attachment. Reviewers promote
 *     by editing the canonical review fields, separately.
 *   - **Returns 404** when `receiptId` doesn't exist — never
 *     fabricates a receipt to attach to.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { attachOcrSuggestion } from "@/lib/ops/docs";
import {
  extractReceiptFromText,
  isReceiptOcrSuggestion,
} from "@/lib/ops/receipt-ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body === null || typeof body !== "object") {
    return NextResponse.json(
      { error: "body must be a JSON object" },
      { status: 400 },
    );
  }
  const b = body as Record<string, unknown>;

  const receiptId =
    typeof b.receiptId === "string" && b.receiptId.trim().length > 0
      ? b.receiptId.trim()
      : null;
  if (!receiptId) {
    return NextResponse.json(
      { error: "receiptId is required (non-empty string)" },
      { status: 400 },
    );
  }

  // Determine the suggestion: either run extraction on supplied
  // ocrText, or accept a pre-extracted envelope from a trusted
  // caller. We refuse to mix the two — pick exactly one path so
  // the caller's intent is unambiguous.
  const hasOcrText = typeof b.ocrText === "string";
  const hasSuggestion = b.suggestion !== undefined;
  if (!hasOcrText && !hasSuggestion) {
    return NextResponse.json(
      {
        error:
          "exactly one of `ocrText` (string) or `suggestion` (envelope) is required",
      },
      { status: 400 },
    );
  }
  if (hasOcrText && hasSuggestion) {
    return NextResponse.json(
      {
        error:
          "ambiguous body — provide EITHER `ocrText` OR `suggestion`, not both",
      },
      { status: 400 },
    );
  }

  let suggestion;
  if (hasOcrText) {
    suggestion = extractReceiptFromText(b.ocrText as string);
  } else {
    if (!isReceiptOcrSuggestion(b.suggestion)) {
      return NextResponse.json(
        {
          error:
            "suggestion envelope is malformed — must include vendor|date|amount|currency|tax|last4|paymentHint (each `string|number|null`), confidence ('high'|'medium'|'low'), warnings: string[], rawText, extractedAt",
        },
        { status: 400 },
      );
    }
    suggestion = b.suggestion;
  }

  try {
    const updated = await attachOcrSuggestion(receiptId, suggestion);
    if (!updated) {
      return NextResponse.json(
        { error: "receipt not found", receiptId },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, receipt: updated });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "attach_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
