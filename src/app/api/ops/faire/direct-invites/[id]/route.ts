/**
 * PATCH /api/ops/faire/direct-invites/[id]
 *
 * Internal-only review action for staged Faire Direct invite
 * candidates. Lets an operator update lifecycle status, attach a
 * review note, and (optionally) correct candidate fields. Every
 * accepted change re-runs through `validateInvite()` so a botched
 * correction can't sneak a partial / invalid record into the queue.
 *
 * Hard rules:
 *   - **No email is sent. No Faire API call is made.** This route
 *     never touches Gmail / Slack / faire-client beyond the imports
 *     used by `updateFaireInvite()` (KV only).
 *   - `status="sent"` is rejected with HTTP 422 + stable code
 *     `sent_status_forbidden`. The future Class B
 *     `faire-direct.invite` send closer is the only path that may
 *     flip a record to `sent`.
 *   - Slug / id is immutable across review actions. A corrected
 *     email rewrites the candidate fields but keeps the same KV key.
 *   - Auth: middleware blocks `/api/ops/*` for unauthenticated
 *     traffic; `isAuthorized()` rechecks (session OR CRON_SECRET).
 *
 * Body (PATCH):
 *   {
 *     status?:           "needs_review" | "approved" | "rejected",
 *     reviewNote?:       string,                        // "" clears
 *     fieldCorrections?: Partial<FaireInviteCandidate>, // re-validated
 *     reviewedBy?:       string                          // operator ident
 *   }
 *
 * Status mapping:
 *   200 — updated, body = { ok: true, invite }
 *   400 — empty patch / invalid JSON
 *   401 — unauthenticated
 *   404 — id not in queue
 *   409 — corrected email collides with another existing record
 *   422 — invalid_status / sent_status_forbidden / validation_failed
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getInvite,
  updateFaireInvite,
  type FaireInviteCandidate,
  type InviteUpdatePatch,
} from "@/lib/faire/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
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

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  if (!(await isAuthorized(_req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const invite = await getInvite(id);
  if (!invite) {
    return NextResponse.json(
      { ok: false, error: `Invite ${id} not found` },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, invite });
}

export async function PATCH(req: Request, ctx: RouteContext): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: InviteUpdatePatch = {};
  if (body.status !== undefined) {
    patch.status = body.status as InviteUpdatePatch["status"];
  }
  const note = asString(body.reviewNote);
  if (note !== undefined) patch.reviewNote = note;
  if (
    body.fieldCorrections !== null &&
    typeof body.fieldCorrections === "object" &&
    !Array.isArray(body.fieldCorrections)
  ) {
    patch.fieldCorrections =
      body.fieldCorrections as Partial<FaireInviteCandidate>;
  }
  const reviewedBy = asString(body.reviewedBy);
  if (reviewedBy !== undefined && reviewedBy.trim().length > 0) {
    patch.reviewedBy = reviewedBy;
  }

  const result = await updateFaireInvite(id, patch);
  if (!result.ok) {
    const status =
      result.error.code === "not_found"
        ? 404
        : result.error.code === "no_changes"
          ? 400
          : result.error.code === "duplicate_email"
            ? 409
            : 422;
    return NextResponse.json(
      { ok: false, code: result.error.code, error: result.error.message },
      { status },
    );
  }
  return NextResponse.json({ ok: true, invite: result.invite }, { status: 200 });
}
