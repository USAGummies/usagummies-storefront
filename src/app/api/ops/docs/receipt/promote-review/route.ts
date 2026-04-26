/**
 * POST /api/ops/docs/receipt/promote-review
 *
 * Phase 8 receipt-to-Rene promotion. Builds a Rene approval packet
 * draft from a captured receipt + (optional) OCR suggestion. This
 * endpoint is prepare-for-review only — it does NOT post to QBO,
 * does NOT change the receipt's status, does NOT open a Slack
 * approval, and does NOT touch canonical review fields.
 *
 * Body:
 *   { receiptId: string }
 *
 * Response (200):
 *   {
 *     ok: true,
 *     packet: ReceiptReviewPacket,
 *     taxonomy_status: { has_slug: false, reason: "..." }
 *   }
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` rechecks (session OR
 *     CRON_SECRET) on every call. 401 on rejection.
 *   - **404 when receiptId is unknown.** Never fabricates a
 *     receipt to attach a packet to.
 *   - **Status preserved.** Receipt's `status` is unchanged.
 *     `needs_review` stays `needs_review`. The route's only mutation
 *     is the packet store.
 *   - **No Slack approval opened.** The taxonomy has no
 *     `receipt.review.promote` slug yet. The response surfaces this
 *     gap so reviewers see why a Slack-surfaced approval wasn't
 *     opened. To enable Slack approvals, register a slug in
 *     `contracts/approval-taxonomy.md` and `taxonomy.ts`, then
 *     extend this route.
 *   - **No QBO/HubSpot/Shopify writes.** Static-source assertion
 *     in the test suite locks this — the route module imports
 *     nothing from `qbo*`, `hubspot*`, or any send/Slack helper.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { requestReceiptReviewPromotion } from "@/lib/ops/docs";

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

  try {
    const packet = await requestReceiptReviewPromotion(receiptId);
    if (!packet) {
      return NextResponse.json(
        { error: "receipt not found", receiptId },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      packet,
      // Surface the taxonomy gap explicitly in the envelope so
      // tooling can detect "no slug → no Slack approval" without
      // having to inspect the packet body. Locked by route tests.
      taxonomy_status: {
        has_slug: packet.taxonomy.slug !== null,
        slug: packet.taxonomy.slug,
        class_expected: packet.taxonomy.classExpected,
        reason: packet.taxonomy.reason,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "promote_review_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
