/**
 * POST /api/ops/sales/sample-touch-2/propose
 *
 * Open a Class B `gmail.send` approval card to follow up with a buyer
 * whose sample shipped >7 days ago and who hasn't replied yet.
 *
 * Closes "could-be-better #7" — sample-queue health is detected (D2
 * surface in morning brief), but no fire path existed. Now: caller
 * resolves the deal's contact email from HubSpot, hits this endpoint,
 * card lands in #ops-approvals.
 *
 * Reuses the existing email-reply closer (executeApprovedEmailReply)
 * via `targetEntity.type: "email-reply"` + `payloadRef: gmail:draft:<id>`.
 *
 * Body (JSON):
 *   {
 *     hubspotDealId: string,                    // stable id
 *     buyerEmail: string,                       // resolved by caller
 *     buyerFirstName?: string,                  // optional greeting personalization
 *     displayName: string,                      // "Eric Forst — Red Dog Saloon"
 *     daysSinceShipped: number,
 *     sampleSize?: "case" | "mailer" | "master_carton",  // default "case"
 *     sources?: [{system, id?, url?}],
 *     dryRun?: boolean
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
  composeSampleTouch2Draft,
  type SampleTouch2DraftInput,
} from "@/lib/sales/sample-touch-2/draft";
import { renderSampleTouch2Card } from "@/lib/sales/sample-touch-2/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProposeBody {
  hubspotDealId: string;
  buyerEmail: string;
  buyerFirstName?: string;
  displayName: string;
  daysSinceShipped: number;
  sampleSize?: "case" | "mailer" | "master_carton";
  sources?: Array<{ system: string; id?: string; url?: string }>;
  dryRun?: boolean;
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VALID_SIZES = ["case", "mailer", "master_carton"] as const;

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

  if (!body.hubspotDealId || typeof body.hubspotDealId !== "string") {
    return NextResponse.json(
      { error: "hubspotDealId required" },
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
    typeof body.daysSinceShipped !== "number" ||
    !Number.isFinite(body.daysSinceShipped) ||
    body.daysSinceShipped < 0
  ) {
    return NextResponse.json(
      { error: "daysSinceShipped required (non-negative number)" },
      { status: 400 },
    );
  }
  if (
    body.sampleSize !== undefined &&
    !VALID_SIZES.includes(body.sampleSize)
  ) {
    return NextResponse.json(
      { error: `sampleSize must be one of ${VALID_SIZES.join("/")}` },
      { status: 400 },
    );
  }

  const draftInput: SampleTouch2DraftInput = {
    buyerFirstName: body.buyerFirstName,
    displayName: body.displayName,
    daysSinceShipped: body.daysSinceShipped,
    sampleSize: body.sampleSize,
  };
  const draft = composeSampleTouch2Draft(draftInput);

  const renderedMarkdown = renderSampleTouch2Card({
    hubspotDealId: body.hubspotDealId,
    displayName: body.displayName,
    buyerEmail: body.buyerEmail,
    daysSinceShipped: body.daysSinceShipped,
    subject: draft.subject,
    body: draft.body,
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

  const draftRes = await createGmailDraft({
    to: body.buyerEmail,
    subject: draft.subject,
    body: draft.body,
    // No threadId — outbound check-in, not a reply to an inbound thread.
  });
  if (!draftRes.ok) {
    return NextResponse.json(
      { ok: false, error: `Gmail draft create failed: ${draftRes.error}` },
      { status: 502 },
    );
  }

  const run = newRunContext({
    agentId: "sample-touch-2-propose",
    division: "sales",
    source: "event",
    trigger: `sample-touch-2:${body.hubspotDealId}`,
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
            system: "hubspot:deal",
            id: body.hubspotDealId,
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
        id: body.hubspotDealId,
        label: `Sample Touch-2: ${body.displayName}`,
      },
      payloadPreview: renderedMarkdown,
      payloadRef: `gmail:draft:${draftRes.draftId}`,
      evidence: {
        claim: `Send Touch-2 follow-up to ${body.buyerEmail} — sample shipped ${body.daysSinceShipped} days ago, no buyer reply detected.`,
        sources: approvalSources,
        confidence: 0.9,
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
