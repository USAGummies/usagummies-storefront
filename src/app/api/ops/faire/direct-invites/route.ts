/**
 * GET  /api/ops/faire/direct-invites — list queued invite candidates,
 *                                       grouped by status.
 * POST /api/ops/faire/direct-invites — stage retailer invite candidates
 *                                       from JSON rows.
 *
 * Phase 1 contract (review-queue only):
 *   - No email is sent.
 *   - No Faire API call is made (the eventual send route is a future
 *     Phase 2 build, gated by Class B `faire-direct.invite` per
 *     /contracts/approval-taxonomy.md and /contracts/agents/
 *     faire-specialist.md).
 *   - When `FAIRE_ACCESS_TOKEN` is missing, GET surfaces a `degraded`
 *     flag so the dashboard can render its banner. Ingest still works
 *     — staging candidates doesn't depend on the token.
 *
 * Auth: middleware blocks `/api/ops/*` for unauthenticated traffic;
 * `isAuthorized()` re-checks (session OR CRON_SECRET) inside.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  ingestInviteRows,
  isFaireConfigured,
  listInvitesByStatus,
  type FaireInviteCandidate,
} from "@/lib/faire/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  rows?: unknown;
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const grouped = await listInvitesByStatus();
  const totals = {
    needs_review: grouped.needs_review.length,
    approved: grouped.approved.length,
    sent: grouped.sent.length,
    rejected: grouped.rejected.length,
    total:
      grouped.needs_review.length +
      grouped.approved.length +
      grouped.sent.length +
      grouped.rejected.length,
  };
  const faireConfigured = isFaireConfigured();
  return NextResponse.json({
    ok: true,
    /**
     * Degraded flag is true when FAIRE_ACCESS_TOKEN isn't set. The
     * queue still works (staging candidates is the operator's job),
     * but the eventual send-on-approve path will be unavailable.
     */
    degraded: !faireConfigured,
    degradedReason: faireConfigured
      ? null
      : "FAIRE_ACCESS_TOKEN is not set. Queue staging works; send-on-approve unavailable until the token lands.",
    totals,
    invites: grouped,
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return NextResponse.json(
      {
        error:
          "rows must be an array of partial FaireInviteCandidate records.",
      },
      { status: 400 },
    );
  }

  const result = await ingestInviteRows(
    body.rows as Array<Partial<FaireInviteCandidate>>,
  );

  // Status mapping mirrors /api/ops/locations/ingest:
  //   201 — every row queued
  //   207 — mixed accepted + errors (Multi-Status)
  //   200 — nothing accepted; operator review starts with errors[]
  const status =
    result.queued > 0 && result.errors.length > 0
      ? 207
      : result.queued > 0
        ? 201
        : 200;
  return NextResponse.json(result, { status });
}
