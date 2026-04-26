/**
 * POST /api/ops/locations/ingest — stage rows for review.
 * GET  /api/ops/locations/ingest — list drafts grouped by status.
 *
 * Internal-only — middleware (`/api/ops/*`) requires a session, so
 * unauthenticated traffic gets a 401 before reaching this handler.
 *
 * The whole point of this route is **observability + staging without
 * publication**:
 *   - Drafts land in KV (`locations:drafts:<slug>`), never on the
 *     public `/where-to-buy` page.
 *   - `src/data/retailers.ts` is the only source the public page
 *     reads; this route never touches it.
 *   - Promotion of an accepted draft to the public list is a separate
 *     (future) flow — typically a PR appending to `retailers.ts`.
 *
 * Body shape (POST):
 *   {
 *     rows: Array<RetailerLocation>,    // required, run through normalizeStoreLocation
 *     ingestSource?: string             // free-form label, e.g. "faire-csv-2026-04"
 *   }
 *
 * Response (POST):
 *   {
 *     ok: boolean,
 *     draftsCreated: number,
 *     draftsTotal: number,
 *     errors: Array<{ rowIndex, code, detail, identifier }>,
 *     createdSlugs: string[],
 *     ingestSource: string
 *   }
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  ingestRows,
  listDraftsByStatus,
  readLastIngestErrors,
} from "@/lib/locations/drafts";
import type { RetailerLocation } from "@/data/retailers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  rows?: unknown;
  ingestSource?: unknown;
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
        error: "rows must be an array of partial RetailerLocation records",
      },
      { status: 400 },
    );
  }

  const ingestSource =
    typeof body.ingestSource === "string" && body.ingestSource.trim().length > 0
      ? body.ingestSource.trim()
      : "manual";

  const result = await ingestRows(
    body.rows as Array<Partial<RetailerLocation>>,
    { ingestSource },
  );

  // 207 (Multi-Status) when there's a mix of created + errors;
  // 201 when every row produced a draft; 200 when nothing was
  // accepted (operator review starts with the error list).
  const status =
    result.draftsCreated > 0 && result.errors.length > 0
      ? 207
      : result.draftsCreated > 0
        ? 201
        : 200;
  return NextResponse.json(result, { status });
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const grouped = await listDraftsByStatus();
  const lastErrors = await readLastIngestErrors();
  const totals = {
    needs_review: grouped.needs_review.length,
    accepted: grouped.accepted.length,
    rejected: grouped.rejected.length,
    total:
      grouped.needs_review.length +
      grouped.accepted.length +
      grouped.rejected.length,
  };
  return NextResponse.json({
    ok: true,
    totals,
    drafts: grouped,
    lastErrors,
  });
}
