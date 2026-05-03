/**
 * POST /api/ops/sales/reorder-offer/propose
 *
 * Open a Class B `gmail.send` approval card for a reorder offer email.
 * Replaces the dead-letter pattern where the morning brief surfaced
 * "send DTC reorder offer to Vicki Williams ($51 lifetime)" daily for
 * 95+ days with no fire path. Now: caller hits this endpoint, Gmail
 * draft is created, approval card lands in #ops-approvals, Ben taps
 * Approve once → email sends + HubSpot logs the engagement.
 *
 * Reuses the existing email-reply closer (`executeApprovedEmailReply`)
 * via `targetEntity.type: "email-reply"` + `payloadRef: gmail:draft:<id>`.
 *
 * Body (JSON):
 *   {
 *     channel: "shopify-dtc" | "wholesale",     // amazon-fbm not supported
 *                                               //   (no Amazon outbound email path)
 *     candidateId: string,                      // stable id (e.g. shopify-customer:123 or hubspot-deal:456)
 *     buyerEmail: string,                       // resolved by caller
 *     buyerFirstName?: string,                  // optional greeting personalization
 *     displayName: string,                      // "Vicki Williams" / "Old Mill Gift Shop"
 *     daysSinceLastOrder: number,
 *     windowDays: number,
 *     discountCode?: string,                    // DTC only — caller supplies; no auto-generation
 *     discountPct?: number,
 *     sources?: [{system, id?, url?}],          // where the candidate came from
 *     dryRun?: boolean                          // returns rendered card without firing
 *   }
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { requestApproval } from "@/lib/ops/control-plane/record";
import { createGmailDraft } from "@/lib/ops/gmail-reader";
import {
  composeReorderOfferDraft,
  type ReorderOfferDraftInput,
} from "@/lib/sales/reorder-offer/draft";
import { renderReorderOfferCard } from "@/lib/sales/reorder-offer/card";
import type { ReorderChannel } from "@/lib/sales/reorder-followup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProposeBody {
  channel: ReorderChannel;
  candidateId: string;
  buyerEmail: string;
  buyerFirstName?: string;
  displayName: string;
  daysSinceLastOrder: number;
  windowDays: number;
  discountCode?: string;
  discountPct?: number;
  sources?: Array<{ system: string; id?: string; url?: string }>;
  dryRun?: boolean;
}

const VALID_CHANNELS: ReorderChannel[] = ["shopify-dtc", "wholesale"];
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ProposeBody;
  try {
    body = (await req.json()) as ProposeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validation — fail-fast on bad input. The card never lands in
  // #ops-approvals if the inputs are wrong.
  if (!body.candidateId || typeof body.candidateId !== "string") {
    return NextResponse.json(
      { error: "candidateId required (stable id)" },
      { status: 400 },
    );
  }
  if (!VALID_CHANNELS.includes(body.channel)) {
    return NextResponse.json(
      {
        error:
          `channel must be one of ${VALID_CHANNELS.join("/")} — amazon-fbm not supported (no Amazon outbound email path).`,
      },
      { status: 400 },
    );
  }
  if (!body.buyerEmail || !EMAIL_REGEX.test(body.buyerEmail)) {
    return NextResponse.json(
      { error: "buyerEmail required (must be a valid email)" },
      { status: 400 },
    );
  }
  if (!body.displayName || typeof body.displayName !== "string") {
    return NextResponse.json(
      { error: "displayName required" },
      { status: 400 },
    );
  }
  if (
    typeof body.daysSinceLastOrder !== "number" ||
    !Number.isFinite(body.daysSinceLastOrder)
  ) {
    return NextResponse.json(
      { error: "daysSinceLastOrder required (number)" },
      { status: 400 },
    );
  }
  if (
    typeof body.windowDays !== "number" ||
    !Number.isFinite(body.windowDays)
  ) {
    return NextResponse.json(
      { error: "windowDays required (number)" },
      { status: 400 },
    );
  }

  // Build the email draft.
  const draftInput: ReorderOfferDraftInput = {
    channel: body.channel,
    buyerFirstName: body.buyerFirstName,
    displayName: body.displayName,
    daysSinceLastOrder: body.daysSinceLastOrder,
    discountCode: body.discountCode,
    discountPct: body.discountPct,
  };
  const draft = composeReorderOfferDraft(draftInput);

  // Render the markdown card (used as payloadPreview).
  const renderedMarkdown = renderReorderOfferCard({
    channel: body.channel,
    candidateId: body.candidateId,
    displayName: body.displayName,
    buyerEmail: body.buyerEmail,
    daysSinceLastOrder: body.daysSinceLastOrder,
    windowDays: body.windowDays,
    subject: draft.subject,
    body: draft.body,
    template: draft.template,
    discountCode: body.discountCode,
    sources: body.sources,
  });

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      posted: false,
      draft,
      renderedMarkdown,
    });
  }

  // Create the Gmail draft. The closer will fire `users.drafts.send`
  // on approve via the existing email-reply executor.
  const draftRes = await createGmailDraft({
    to: body.buyerEmail,
    subject: draft.subject,
    body: draft.body,
    // outbound — no inbound thread to reply to (threadId omitted)
  });
  if (!draftRes.ok) {
    return NextResponse.json(
      { ok: false, error: `Gmail draft create failed: ${draftRes.error}` },
      { status: 502 },
    );
  }

  // Open the Class B approval. The approval-surface posts the card
  // to #ops-approvals with the Approve / Reject / Ask buttons.
  const run = newRunContext({
    agentId: "reorder-offer-propose",
    division: "sales",
    source: "event",
    trigger: `reorder-offer:${body.channel}:${body.candidateId}`,
  });

  const retrievedAt = new Date().toISOString();
  const approvalSources =
    body.sources && body.sources.length > 0
      ? body.sources.map((s) => ({
          system: s.system,
          id: s.id,
          url: s.url,
          retrievedAt,
        }))
      : [
          {
            system: "reorder-offer:propose",
            id: body.candidateId,
            retrievedAt,
          },
        ];

  let approvalId: string | null = null;
  let approvalTs: string | null = null;
  let approvalErr: string | null = null;

  try {
    const approval = await requestApproval(run, {
      actionSlug: "gmail.send",
      targetSystem: "gmail",
      targetEntity: {
        type: "email-reply",
        id: body.candidateId,
        label: `Reorder offer to ${body.displayName}`,
      },
      payloadPreview: renderedMarkdown,
      payloadRef: `gmail:draft:${draftRes.draftId}`,
      evidence: {
        claim: `Send reorder offer email to ${body.buyerEmail} — ${body.daysSinceLastOrder} days since last order on ${body.channel} (window ${body.windowDays}d).`,
        sources: approvalSources,
        confidence: 0.92,
      },
      rollbackPlan:
        "Gmail undo-send window (~30s after dispatch). Past 30s: send a follow-up correction email + delete the HubSpot timeline entry.",
    });
    approvalId = approval.id;
    approvalTs = approval.slackThread?.ts ?? null;
  } catch (err) {
    approvalErr = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    ok: approvalErr === null,
    posted: approvalId !== null,
    postedTo: approvalId ? "#ops-approvals" : null,
    approvalId,
    proposalTs: approvalTs,
    draftId: draftRes.draftId,
    draftOpenUrl: draftRes.openUrl,
    renderedMarkdown,
    error: approvalErr,
  });
}
