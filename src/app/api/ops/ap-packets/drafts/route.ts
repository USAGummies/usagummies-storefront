/**
 * GET/POST /api/ops/ap-packets/drafts
 *
 * Internal AP-packet draft store. Read-only by default (GET), with a
 * single mutating verb (POST = create draft from template). The
 * mutation only writes to KV — never sends email, never writes QBO,
 * never touches Drive. Drafts are intentionally invisible to the
 * live `/api/ops/fulfillment/ap-packet/send` route (`getApPacket()`
 * does not see them), so a draft can never be sent to a retailer
 * accidentally; the operator must promote the draft to a live packet
 * via a separate (future) flow before send becomes possible.
 *
 * Body (POST):
 *   {
 *     slug: "whole-foods",                 // kebab-case, 2-42 chars
 *     templateSlug: "usa-gummies-base",    // from /templates
 *     accountName: "Whole Foods Market",   // retailer name
 *     apEmail: "vendorsetup@wholefoods.com",
 *     owner?: "Rene Gonzalez",
 *     dueWindow?: "Return within 5 business days",
 *     note?: "free-form context"
 *   }
 *
 * Response (POST):
 *   { ok: true, draft: ApPacketDraft }
 *
 * Auth: session OR bearer CRON_SECRET (under /api/ops/ap-packets,
 * already in middleware allowlist).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  createApPacketDraft,
  DraftValidationError,
  getApPacketDraft,
  listApPacketDrafts,
  listApPacketTemplates,
  TemplateNotFoundError,
} from "@/lib/ops/ap-packets/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateDraftBody {
  slug?: unknown;
  templateSlug?: unknown;
  accountName?: unknown;
  apEmail?: unknown;
  owner?: unknown;
  dueWindow?: unknown;
  note?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug")?.trim();

  if (slug) {
    const draft = await getApPacketDraft(slug);
    if (!draft) {
      return NextResponse.json(
        { ok: false, error: `Draft ${slug} not found` },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, draft });
  }

  // No slug → return the roster of drafts + the template registry.
  // Both surfaces the dashboard needs in one round-trip.
  const drafts = await listApPacketDrafts();
  const templates = listApPacketTemplates().map((t) => ({
    slug: t.slug,
    label: t.label,
    purpose: t.purpose,
    requiredAttachmentIds: t.defaultAttachments
      .filter((a) => a.status === "missing")
      .map((a) => a.id),
  }));
  return NextResponse.json({
    ok: true,
    drafts,
    templates,
    counts: {
      drafts: drafts.length,
      incomplete: drafts.filter((d) => !d.requiredFieldsComplete).length,
      complete: drafts.filter((d) => d.requiredFieldsComplete).length,
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateDraftBody;
  try {
    body = (await req.json()) as CreateDraftBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = asString(body.slug)?.trim();
  const templateSlug = asString(body.templateSlug)?.trim();
  const accountName = asString(body.accountName)?.trim();
  const apEmail = asString(body.apEmail)?.trim();

  if (!slug || !templateSlug || !accountName || !apEmail) {
    return NextResponse.json(
      {
        error:
          "Required: slug, templateSlug, accountName, apEmail (use GET to list available templates).",
      },
      { status: 400 },
    );
  }

  // Refuse to overwrite an existing draft via POST — operator must
  // explicitly delete (future endpoint) or use a different slug. This
  // is the simplest way to avoid clobbering an in-progress packet.
  const existing = await getApPacketDraft(slug);
  if (existing) {
    return NextResponse.json(
      {
        ok: false,
        error: `Draft ${slug} already exists (created ${existing.createdAt}). Use a different slug or update through a future patch endpoint.`,
      },
      { status: 409 },
    );
  }

  try {
    const draft = await createApPacketDraft({
      slug,
      templateSlug,
      accountName,
      apEmail,
      owner: asString(body.owner)?.trim() || undefined,
      dueWindow: asString(body.dueWindow)?.trim() || undefined,
      note: asString(body.note)?.trim() || undefined,
    });
    return NextResponse.json({ ok: true, draft }, { status: 201 });
  } catch (err) {
    if (err instanceof DraftValidationError) {
      return NextResponse.json(
        { ok: false, error: err.message, issues: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof TemplateNotFoundError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
