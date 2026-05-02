/**
 * GET /api/ops/finance/today
 *
 * Browser-parity surface for the `finance today` Slack card. Reads
 * pending finance approvals + receipt review packets fail-soft and
 * returns the rolled-up `FinanceTodaySummary` so the dashboard / CLI
 * gets the same view as the Slack card.
 *
 * Hard rules:
 *   - Auth-gated: `isAuthorized()` (session OR bearer CRON_SECRET).
 *   - Read-only: never opens approvals, never mutates packets, never
 *     writes to QBO/Plaid/HubSpot/Shopify.
 *   - Fail-soft: each source error lands in `degraded`, never throws.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import { listReceiptReviewPackets } from "@/lib/ops/docs";
import { summarizeFinanceToday } from "@/lib/ops/finance-today";
import type {
  ApprovalRequest,
} from "@/lib/ops/control-plane/types";
import type { ReceiptReviewPacket } from "@/lib/ops/receipt-review-packet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const degraded: string[] = [];

  let approvals: ApprovalRequest[] = [];
  try {
    approvals = await approvalStore().listPending();
  } catch (err) {
    degraded.push(
      `approvals:${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let packets: ReceiptReviewPacket[] = [];
  try {
    packets = await listReceiptReviewPackets({ limit: 200 });
  } catch (err) {
    degraded.push(
      `packets:${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const summary = summarizeFinanceToday({
    pendingApprovals: approvals,
    packets,
    degraded,
    now: new Date(),
  });

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    notes: {
      sources: [
        "approvalStore.listPending() — finance-class only",
        "listReceiptReviewPackets({ limit: 200 })",
      ],
      doctrine: "/contracts/approval-taxonomy.md (receipt.review.promote Class B)",
    },
  });
}
