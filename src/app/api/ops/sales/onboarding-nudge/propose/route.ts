/**
 * POST /api/ops/sales/onboarding-nudge/propose
 *
 * Open a Class B `gmail.send` approval card to nudge a buyer whose
 * wholesale onboarding flow has stalled at a step. Closes audit
 * finding "Missing #15" — the brief surfaces stalled flows daily
 * (Thanksgiving Point parked 4+ days at store-type) but no fire
 * path existed.
 *
 * Reuses the existing email-reply closer (executeApprovedEmailReply)
 * via `targetEntity.type: "email-reply"` + `payloadRef: gmail:draft:<id>`.
 *
 * Body (JSON):
 *   {
 *     flowId: string,                    // wholesale-onboarding KV flow id
 *     buyerEmail: string,                // resolved by caller from prospect.email
 *     buyerFirstName?: string,
 *     displayName: string,               // prospect.companyName
 *     currentStep: OnboardingStep,       // step the flow parked on
 *     daysSinceLastTouch: number,
 *     onboardingUrl: string,             // canonical: /onboarding/<dealId>
 *     hubspotDealId?: string,            // cross-link
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
  composeOnboardingNudgeDraft,
  type OnboardingNudgeDraftInput,
} from "@/lib/sales/onboarding-nudge/draft";
import { renderOnboardingNudgeCard } from "@/lib/sales/onboarding-nudge/card";
import type { OnboardingStep } from "@/lib/wholesale/onboarding-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProposeBody {
  flowId: string;
  buyerEmail: string;
  buyerFirstName?: string;
  displayName: string;
  currentStep: OnboardingStep;
  daysSinceLastTouch: number;
  onboardingUrl: string;
  hubspotDealId?: string;
  sources?: Array<{ system: string; id?: string; url?: string }>;
  dryRun?: boolean;
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VALID_STEPS: readonly OnboardingStep[] = [
  "info",
  "store-type",
  "pricing-shown",
  "order-type",
  "payment-path",
  "ap-info",
  "order-captured",
  "shipping-info",
  "ap-email-sent",
  "qbo-customer-staged",
  "crm-updated",
];

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

  if (!body.flowId || typeof body.flowId !== "string") {
    return NextResponse.json({ error: "flowId required" }, { status: 400 });
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
  if (!body.currentStep || !VALID_STEPS.includes(body.currentStep)) {
    return NextResponse.json(
      {
        error: `currentStep required (one of ${VALID_STEPS.join("/")})`,
      },
      { status: 400 },
    );
  }
  if (
    typeof body.daysSinceLastTouch !== "number" ||
    !Number.isFinite(body.daysSinceLastTouch) ||
    body.daysSinceLastTouch < 0
  ) {
    return NextResponse.json(
      { error: "daysSinceLastTouch required (non-negative number)" },
      { status: 400 },
    );
  }
  if (!body.onboardingUrl || !/^https?:\/\//.test(body.onboardingUrl)) {
    return NextResponse.json(
      { error: "onboardingUrl required (must start with http:// or https://)" },
      { status: 400 },
    );
  }

  const draftInput: OnboardingNudgeDraftInput = {
    buyerFirstName: body.buyerFirstName,
    displayName: body.displayName,
    currentStep: body.currentStep,
    daysSinceLastTouch: body.daysSinceLastTouch,
    onboardingUrl: body.onboardingUrl,
  };
  const draft = composeOnboardingNudgeDraft(draftInput);

  const renderedMarkdown = renderOnboardingNudgeCard({
    flowId: body.flowId,
    displayName: body.displayName,
    buyerEmail: body.buyerEmail,
    currentStep: body.currentStep,
    daysSinceLastTouch: body.daysSinceLastTouch,
    onboardingUrl: body.onboardingUrl,
    hubspotDealId: body.hubspotDealId,
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
  });
  if (!draftRes.ok) {
    return NextResponse.json(
      { ok: false, error: `Gmail draft create failed: ${draftRes.error}` },
      { status: 502 },
    );
  }

  const run = newRunContext({
    agentId: "onboarding-nudge-propose",
    division: "sales",
    source: "event",
    trigger: `onboarding-nudge:${body.flowId}:${body.currentStep}`,
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
            system: "wholesale-onboarding-kv",
            id: body.flowId,
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
        id: body.flowId,
        label: `Onboarding nudge: ${body.displayName} (${body.currentStep})`,
      },
      payloadPreview: renderedMarkdown,
      payloadRef: `gmail:draft:${draftRes.draftId}`,
      evidence: {
        claim: `Send onboarding-stall nudge to ${body.buyerEmail} — flow parked at '${body.currentStep}' for ${body.daysSinceLastTouch}d.`,
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
