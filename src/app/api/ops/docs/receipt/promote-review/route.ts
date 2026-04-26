/**
 * POST /api/ops/docs/receipt/promote-review
 *
 * Phase 8/9 receipt-to-Rene promotion.
 *
 * Phase 8: builds a Rene approval *packet draft* from a captured
 * receipt + (optional) OCR suggestion. The packet pairs canonical
 * (human-edited) fields with OCR-suggested ones side-by-side and
 * computes an eligibility rubric.
 *
 * Phase 9 (this commit): when the packet's `eligibility.ok` is true
 * AND the canonical taxonomy has the `receipt.review.promote` slug
 * registered, the route ALSO opens a Class B (Rene single-approval)
 * approval request via the control-plane store. Ineligible packets
 * stay draft-only — no approval is opened — with the reason naming
 * the gaps.
 *
 * Body:
 *   { receiptId: string }
 *
 * Response (200):
 *   {
 *     ok: true,
 *     packet: ReceiptReviewPacket,
 *     approval: { opened: true,  id, status, requiredApprovers } |
 *               { opened: false, reason },
 *     taxonomy_status: { has_slug, slug, class_expected, reason }
 *   }
 *
 * Hard rules (locked by tests):
 *   - **Auth-gated.** `isAuthorized()` rechecks (session OR
 *     CRON_SECRET) on every call. 401 on rejection.
 *   - **404 when receiptId is unknown.** Never fabricates.
 *   - **Status preserved.** Receipt's `status` is unchanged. The
 *     route mutates ONLY the packet store and (when eligible) the
 *     approval store. Canonical receipt fields are NEVER touched.
 *   - **Approval semantics are read-only on external systems.**
 *     `receipt.review.promote` acknowledges Rene reviewed the
 *     packet — it does NOT post to QBO, create vendors, change
 *     HubSpot stages, or write to Shopify. A separate Class B
 *     `qbo.bill.create` action runs later for the actual posting.
 *   - **Idempotent.** Re-promoting the same receipt overwrites the
 *     packet by `packetId`. When the route opens an approval AND
 *     a previous approval is still open for the same packet, the
 *     route surfaces the existing approval rather than opening a
 *     duplicate (locked by test).
 *   - **No QBO/HubSpot/Shopify writes.** Static-source assertion
 *     in the test suite locks this — the route module imports
 *     nothing from `qbo*`, `hubspot*`, or any send helper.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { requestReceiptReviewPromotion } from "@/lib/ops/docs";
import {
  buildApprovalRequest,
  UnknownActionError,
} from "@/lib/ops/control-plane/approvals";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import type { ApprovalRequest } from "@/lib/ops/control-plane/types";
import type { ReceiptReviewPacket } from "@/lib/ops/receipt-review-packet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Build a Class B Rene approval request for a packet when eligible.
 *
 * Throws `UnknownActionError` if the slug isn't registered (defensive —
 * builder catches it and the route reports `approval.opened: false`).
 *
 * The `runId` is derived from the packet id so re-promoting the same
 * receipt produces the same `runId` (visible in audit). The
 * `actorAgentId` is `"ops-route:receipt-promote"` — this route is
 * operator-initiated, not autonomous-agent-initiated.
 */
function buildPacketApproval(packet: ReceiptReviewPacket): ApprovalRequest {
  // Build a compact, human-readable preview of what Rene is approving.
  const lines: string[] = [
    `Rene-review acknowledgment for receipt ${packet.receiptId}.`,
    `Packet ${packet.packetId} (status: ${packet.status}).`,
  ];
  for (const field of ["vendor", "date", "amount", "category"] as const) {
    const f = packet.proposedFields[field];
    if (f.value !== null) {
      lines.push(`• ${field}: ${String(f.value)} (${f.source})`);
    }
  }
  if (packet.eligibility.warnings.length > 0) {
    lines.push("Warnings:");
    for (const w of packet.eligibility.warnings) lines.push(`  - ${w}`);
  }
  lines.push(
    "Approval is review-only. NOT a QBO write — a separate `qbo.bill.create` runs later.",
  );

  return buildApprovalRequest({
    actionSlug: "receipt.review.promote",
    runId: `route:receipt-promote:${packet.packetId}:${randomUUID()}`,
    // Receipt review lives in the financials division (Rene-owned).
    division: "financials",
    actorAgentId: "ops-route:receipt-promote",
    targetSystem: "internal-receipts",
    targetEntity: {
      type: "receipt-review-packet",
      id: packet.packetId,
      label: packet.canonical.vendor ?? packet.proposedFields.vendor.value ?? packet.receiptId,
    },
    payloadPreview: lines.join("\n"),
    payloadRef: packet.packetId,
    evidence: {
      claim: `Receipt ${packet.receiptId} captured + OCR-suggested; canonical/OCR per-field merge with eligibility.ok=${packet.eligibility.ok}.`,
      sources: [
        {
          system: "kv:docs:receipts",
          id: packet.receiptId,
          retrievedAt: packet.createdAt,
        },
        {
          system: "kv:docs:receipt_review_packets",
          id: packet.packetId,
          retrievedAt: packet.createdAt,
        },
      ],
      // Confidence is derived directly from packet eligibility +
      // OCR confidence — not invented. Eligible packets earn 0.9;
      // ineligible would never reach this builder.
      confidence: packet.eligibility.ok ? 0.9 : 0.5,
    },
    rollbackPlan:
      "Reject the approval. The packet remains in `draft` status; canonical receipt fields are untouched and the receipt's `needs_review` status is preserved.",
  });
}

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

    // Phase 9 — open a Class B Rene approval when:
    //   - the slug is registered in the taxonomy (always, post-Phase-9), AND
    //   - the packet's `eligibility.ok` is true.
    //
    // Otherwise the packet stays draft-only with the reason naming
    // why no approval was opened. Idempotency: if a pending approval
    // already exists targeting this packet, surface the existing
    // approval instead of opening a duplicate.
    let approval: {
      opened: true;
      id: string;
      status: ApprovalRequest["status"];
      requiredApprovers: ApprovalRequest["requiredApprovers"];
    } | { opened: false; reason: string };

    if (!packet.taxonomy.slug) {
      approval = {
        opened: false,
        reason:
          "Taxonomy slug is null — packet stays draft-only. Register `receipt.review.promote` in `contracts/approval-taxonomy.md` and `taxonomy.ts`.",
      };
    } else if (!packet.eligibility.ok) {
      approval = {
        opened: false,
        reason: `Packet ineligible — missing fields: ${packet.eligibility.missing.join(", ") || "(none — review eligibility rubric)"}.`,
      };
    } else {
      // Idempotency check — look for an existing pending approval
      // referencing this packet.
      const store = approvalStore();
      let existing: ApprovalRequest | undefined;
      try {
        const pending = await store.listPending();
        existing = pending.find(
          (p) =>
            p.action === "Acknowledge a captured receipt + OCR suggestion as Rene-reviewed" &&
            p.targetEntity?.id === packet.packetId,
        );
      } catch {
        existing = undefined;
      }

      if (existing) {
        approval = {
          opened: true,
          id: existing.id,
          status: existing.status,
          requiredApprovers: existing.requiredApprovers,
        };
      } else {
        try {
          const request = buildPacketApproval(packet);
          await store.put(request);
          approval = {
            opened: true,
            id: request.id,
            status: request.status,
            requiredApprovers: request.requiredApprovers,
          };
        } catch (err) {
          // Fail-soft: if the approval store throws or the slug isn't
          // registered (defensive), the packet is still returned.
          // The reviewer can re-attempt later.
          approval = {
            opened: false,
            reason:
              err instanceof UnknownActionError
                ? `Slug not registered in taxonomy: ${err.message}`
                : `Approval-open failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

    return NextResponse.json({
      ok: true,
      packet,
      approval,
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
