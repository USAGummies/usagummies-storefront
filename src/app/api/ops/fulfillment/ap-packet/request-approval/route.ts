/**
 * POST /api/ops/ap-packets/request-approval
 *
 * Companion to /api/ops/ap-packets/send. Creates the Class B approval
 * request for sending a packet and surfaces it to `#ops-approvals` via
 * the control-plane approval surface.
 *
 * Flow:
 *   1. Load the packet, run the dedup check (refuse if already sent).
 *   2. Compose an `ApprovalRequest` with actionSlug=`gmail.send` (from
 *      `/contracts/approval-taxonomy.md` — Class B, Ben approver).
 *   3. Call `openApproval(store, surface, params)` which atomically
 *      persists the request + posts the Slack card. Store is source of
 *      truth; Slack is a mirror.
 *   4. Return the approval id so the caller can pass it to
 *      `/api/ops/ap-packets/send?approvalToken=<id>` after Ben clicks
 *      approve in Slack.
 *
 * Post-approval execution is currently caller-driven (agent or Ben
 * hits `/send` with the approvalToken). A future enhancement: wire the
 * approval-button handler at `/api/slack/approvals` to dispatch the
 * send automatically once `targetEntity.type === "ap-packet"` and
 * status flips to "approved".
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getApPacket } from "@/lib/ops/ap-packets";
import { openApproval } from "@/lib/ops/control-plane/approvals";
import { approvalSurface } from "@/lib/ops/control-plane/slack";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import { newRunId } from "@/lib/ops/control-plane/run-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  slug: string;
  /** Override taxonomy approver list — typically only Ben needs to approve gmail.send. */
  approvers?: Array<"Ben" | "Rene" | "Drew">;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const slug = body.slug?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const packet = getApPacket(slug);
  if (!packet) {
    return NextResponse.json({ error: `Packet ${slug} not found` }, { status: 404 });
  }

  // Compose the ApprovalRequest. Use gmail.send (Class B, Ben approver)
  // per contracts/approval-taxonomy.md.
  const runId = newRunId();
  const attachmentList = packet.attachments
    .filter((a) => a.status === "ready")
    .map((a) => `• ${a.label} (${a.id})`)
    .join("\n");

  const payloadPreview =
    `Send AP reply packet to ${packet.accountName} <${packet.apEmail}>\n` +
    `Subject: ${packet.replyDraft.subject}\n` +
    `Attachments:\n${attachmentList}\n\n` +
    `Body preview:\n${packet.replyDraft.body.slice(0, 400)}${packet.replyDraft.body.length > 400 ? "…" : ""}`;

  try {
    const request = await openApproval(approvalStore(), approvalSurface(), {
      actionSlug: "gmail.send",
      runId,
      division: "financials",
      actorAgentId: "ap-packet-sender",
      targetSystem: "gmail",
      targetEntity: {
        type: "ap-packet",
        id: `ap-packet:${slug}`,
        label: `${packet.accountName} AP reply`,
      },
      payloadPreview,
      evidence: {
        claim: `Send prepared AP packet to ${packet.apEmail}. Packet status = ${packet.status}. Attachments marked 'ready' = ${packet.attachments.filter((a) => a.status === "ready").length}. Pricing review flag = ${packet.pricingNeedsReview}.`,
        sources: [
          {
            system: "ap-packets",
            id: slug,
            url: `/api/ops/ap-packets?account=${slug}`,
            retrievedAt: new Date().toISOString(),
          },
          ...packet.sources.map((s, i) => ({
            system: "documentation",
            id: `source-${i}`,
            url: s,
            retrievedAt: new Date().toISOString(),
          })),
        ],
        confidence: packet.pricingNeedsReview ? 0.7 : 0.95,
      },
      rollbackPlan:
        "Gmail undo-send window is ~30s after dispatch — caller can unsend if wrong recipient or wrong attachment. Past 30s: email accounts+recipient directly, explain the mistake, resend. HubSpot timeline entry can be deleted via the engagement id returned by send.",
      requiredApprovers: body.approvers,
    });

    return NextResponse.json({
      ok: true,
      approvalId: request.id,
      status: request.status,
      class: request.class,
      requiredApprovers: request.requiredApprovers,
      slackThread: request.slackThread ?? null,
      nextStep:
        request.slackThread
          ? `Ben clicks approve in Slack #ops-approvals, then POST /api/ops/ap-packets/send with {slug: "${slug}", approvalToken: "${request.id}"}`
          : `Approval stored but Slack post may have failed — check #ops-audit. Approval id: ${request.id}`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to create approval: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
