/**
 * GET /api/ops/docs/receipt-review-packets/[packetId]
 *
 * Phase 12 — read-only status route. Powers the per-row poll on
 * `/ops/finance/review` so the operator sees Rene's
 * `rene-approved`/`rejected` transition reflected inline (without
 * a full page refresh) once the closer (Phase 10) runs.
 *
 * Hard rules:
 *   - **Read-only.** No KV / HubSpot / QBO / Shopify / Slack
 *     mutation. The route returns the packet's current status +
 *     the matching pending/terminal approval status (when
 *     surfaced). It NEVER opens a new approval; that's the
 *     dedicated `POST /api/ops/docs/receipt/promote-review` route.
 *   - **Auth-gated.** `isAuthorized()` rechecks (session OR
 *     CRON_SECRET).
 *   - **404 when packetId unknown.** Never fabricates.
 *   - **No paraphrase / no inflation.** The route returns the
 *     stored status verbatim. The pill renderer paraphrases
 *     nothing.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getReceiptReviewPacket } from "@/lib/ops/docs";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import type { ApprovalRequest } from "@/lib/ops/control-plane/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ packetId: string }>;
}

export async function GET(req: Request, ctx: Params): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { packetId } = await ctx.params;
  if (typeof packetId !== "string" || packetId.trim().length === 0) {
    return NextResponse.json(
      { error: "packetId is required (non-empty string)" },
      { status: 400 },
    );
  }

  try {
    const packet = await getReceiptReviewPacket(packetId);
    if (!packet) {
      return NextResponse.json(
        { error: "packet not found", packetId },
        { status: 404 },
      );
    }

    // Resolve the latest matching approval (pending OR terminal) by
    // targetEntity.id. We list pending first and fall back to a
    // listByAgent scan if needed; both are read-only.
    const store = approvalStore();
    let approval: ApprovalRequest | undefined;
    try {
      const pending = await store.listPending();
      approval = pending.find(
        (p) => p.targetEntity?.id === packet.packetId,
      );
    } catch {
      approval = undefined;
    }
    if (!approval) {
      try {
        const recent = await store.listByAgent(
          "ops-route:receipt-promote",
          50,
        );
        approval = recent.find(
          (p) => p.targetEntity?.id === packet.packetId,
        );
      } catch {
        approval = undefined;
      }
    }

    return NextResponse.json({
      ok: true,
      packetId: packet.packetId,
      receiptId: packet.receiptId,
      packetStatus: packet.status,
      // approvalStatus: pending / approved / rejected / expired /
      //   stood-down — verbatim from the store. null when the packet
      //   was never promoted (Phase 8 path).
      approvalStatus: approval?.status ?? null,
      approvalId: approval?.id ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "status_read_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
