/**
 * GET /api/ops/email-agents/queue
 *
 * Read-only operator-visible queue surface over Phase 37.1 + 37.2 KV
 * state (`inbox:scan:<msgId>` records). Build 3 from
 * `docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md`.
 *
 * Query params:
 *   - status: optional `received | received_noise | classified | classified_whale`
 *     to narrow the response (post-fetch filter — KV doesn't index by status).
 *   - limit:  optional integer, defaults to 2000 (the scanner's hard cap).
 *   - rows:   when `?rows=full`, return every queue row in addition to the
 *             summary. Default `summary-only` so the response stays small
 *             for the daily Slack card.
 *
 * Hard rules:
 *   - Auth-gated: `isAuthorized()` (session OR bearer CRON_SECRET).
 *   - Read-only: never writes to KV, never sends Gmail, never opens an
 *     approval, never mutates HubSpot/QBO/Shopify/ShipStation.
 *   - Fail-soft: KV errors land in `degraded`, never throw the response.
 *   - No secrets, no full email bodies — `email-agent-queue.ts` already
 *     drops the snippet + label ids during projection.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  scanEmailAgentQueue,
  summarizeEmailAgentQueue,
  type EmailAgentQueueStatus,
} from "@/lib/ops/email-agent-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: ReadonlySet<EmailAgentQueueStatus> = new Set([
  "received",
  "received_noise",
  "classified",
  "classified_whale",
]);

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");
  const rowsParam = url.searchParams.get("rows");

  let statusFilter: EmailAgentQueueStatus | undefined;
  if (statusParam) {
    if (!VALID_STATUSES.has(statusParam as EmailAgentQueueStatus)) {
      return NextResponse.json(
        {
          error: `invalid status — expected one of ${Array.from(VALID_STATUSES).join(", ")}`,
        },
        { status: 400 },
      );
    }
    statusFilter = statusParam as EmailAgentQueueStatus;
  }

  let limit: number | undefined;
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "limit must be a positive integer" },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  const includeFullRows = rowsParam === "full";

  const { rows, degraded, truncated } = await scanEmailAgentQueue({
    statusFilter,
    limit,
  });
  const summary = summarizeEmailAgentQueue(rows);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    rows: includeFullRows ? rows : undefined,
    truncated,
    degraded,
    notes: {
      kernel: "phases 37.1 (Inbox Scanner) + 37.2 (Classifier) — viktor lane",
      doctrine: "/contracts/email-agents-system.md",
    },
  });
}
