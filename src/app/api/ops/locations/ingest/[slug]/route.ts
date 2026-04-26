/**
 * PATCH /api/ops/locations/ingest/[slug]
 *
 * Internal-only review action. Lets an operator update a staged draft's
 * lifecycle status, attach a review note, and (optionally) correct
 * specific store fields. Every accepted change is re-validated through
 * `normalizeStoreLocation()` so a botched correction can't sneak a
 * partial / invalid record into the queue.
 *
 * Hard rules:
 *   - This route NEVER mutates `src/data/retailers.ts`.
 *   - This route NEVER auto-publishes to `/where-to-buy`. Promotion to
 *     the public locator stays a manual PR.
 *   - Slug is immutable on update.
 *   - Auth: middleware blocks `/api/ops/*` for unauthenticated traffic.
 *     `isAuthorized()` re-checks session OR CRON_SECRET inside the
 *     route so scripts can use bearer auth.
 *
 * Body (PATCH):
 *   {
 *     status?:           "needs_review" | "accepted" | "rejected",
 *     reviewNote?:       string,                  // "" clears the note
 *     fieldCorrections?: Partial<RetailerLocation>,
 *     reviewedBy?:       string                   // operator email/username
 *   }
 *
 * Status codes:
 *   200 — updated, body = { ok: true, draft }
 *   400 — empty patch / invalid JSON
 *   401 — unauthenticated
 *   404 — slug not in queue
 *   422 — invalid status OR validation_failed correction
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getDraftLocation,
  updateDraftLocation,
  type DraftUpdatePatch,
} from "@/lib/locations/drafts";
import type { RetailerLocation } from "@/data/retailers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

interface PatchBody {
  status?: unknown;
  reviewNote?: unknown;
  fieldCorrections?: unknown;
  reviewedBy?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const draft = await getDraftLocation(slug);
  if (!draft) {
    return NextResponse.json(
      { ok: false, error: `Draft ${slug} not found` },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, draft });
}

export async function PATCH(req: Request, ctx: RouteContext): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: DraftUpdatePatch = {};
  if (body.status !== undefined) {
    // Pass through; the helper enforces the enum and rejects unknown
    // values with `invalid_status`.
    patch.status = body.status as DraftUpdatePatch["status"];
  }
  const note = asString(body.reviewNote);
  if (note !== undefined) patch.reviewNote = note;
  if (
    body.fieldCorrections !== null &&
    typeof body.fieldCorrections === "object" &&
    !Array.isArray(body.fieldCorrections)
  ) {
    patch.fieldCorrections = body.fieldCorrections as Partial<RetailerLocation>;
  }
  const reviewedBy = asString(body.reviewedBy);
  if (reviewedBy !== undefined && reviewedBy.trim().length > 0) {
    patch.reviewedBy = reviewedBy;
  }

  const result = await updateDraftLocation(slug, patch);
  if (!result.ok) {
    const status =
      result.error.code === "not_found"
        ? 404
        : result.error.code === "no_changes"
          ? 400
          : 422; // invalid_status or validation_failed
    return NextResponse.json(
      { ok: false, code: result.error.code, error: result.error.message },
      { status },
    );
  }
  return NextResponse.json({ ok: true, draft: result.draft }, { status: 200 });
}
