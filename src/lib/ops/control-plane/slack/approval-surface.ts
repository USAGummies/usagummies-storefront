/**
 * Slack surface for Class B / Class C approvals.
 *
 * Posts approval requests to `#ops-approvals` with interactive
 * Approve / Reject / Ask buttons. Updates the same message on decision.
 *
 * Contract: /contracts/slack-operating.md §5.2 + approval-taxonomy.md.
 * Canonical blueprint: §15.4 T5c.
 */

import type { ApprovalSlackSurface } from "../approvals";
import type { ApprovalRequest, ChannelId } from "../types";
import { getChannel } from "../channels";

import { postMessage, updateMessage } from "./client";

export class ApprovalSurface implements ApprovalSlackSurface {
  private readonly channelRef: string;

  constructor(channelId: ChannelId = "ops-approvals") {
    const channel = getChannel(channelId);
    this.channelRef = channel?.slackChannelId ?? channel?.name ?? "#ops-approvals";
  }

  async surfaceApproval(request: ApprovalRequest): Promise<{ channel: ChannelId; ts: string }> {
    const { text, blocks } = renderApprovalMessage(request);
    const result = await postMessage({ channel: this.channelRef, text, blocks });

    // Degraded mode: store is authoritative; return a sentinel so the caller
    // knows Slack didn't record a thread but the request itself is valid.
    if (!result.ok || !result.ts) {
      return { channel: "ops-approvals", ts: "" };
    }
    return { channel: "ops-approvals", ts: result.ts };
  }

  async updateApproval(request: ApprovalRequest): Promise<void> {
    if (!request.slackThread?.ts) return; // never surfaced successfully — skip
    const { text, blocks } = renderApprovalMessage(request);
    await updateMessage({
      channel: this.channelRef,
      ts: request.slackThread.ts,
      text,
      blocks,
    });
  }
}

// ---- Rendering ---------------------------------------------------------

function renderApprovalMessage(r: ApprovalRequest): { text: string; blocks: unknown[] } {
  const icon = iconFor(r.status);
  const classLabel = r.class === "C" ? "Class C (dual approval)" : "Class B (single approval)";
  const approvers = r.requiredApprovers.join(" + ");
  const sources = r.evidence.sources
    .map((s) => {
      const parts = [s.system];
      if (s.id) parts.push(s.id);
      return `• ${parts.join(":")} (retrieved ${s.retrievedAt})${s.url ? ` — ${s.url}` : ""}`;
    })
    .join("\n");
  const decisionLines = r.decisions
    .map((d) => {
      const icon = d.decision === "approve" ? "✅" : d.decision === "reject" ? "❌" : "💬";
      return `${icon} ${d.approver}: ${d.decision}${d.reason ? ` — ${d.reason}` : ""} (${d.decidedAt})`;
    })
    .join("\n");

  const fallbackText = `${icon} ${r.action} [${r.id}] — ${r.status}`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${icon} ${r.action}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Status*\n${r.status}` },
        { type: "mrkdwn", text: `*Class*\n${classLabel}` },
        { type: "mrkdwn", text: `*Division*\n${r.division}` },
        { type: "mrkdwn", text: `*Approvers*\n${approvers}` },
        { type: "mrkdwn", text: `*Agent*\n${r.actorAgentId}` },
        { type: "mrkdwn", text: `*Target*\n${r.targetSystem}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Claim*\n${r.evidence.claim}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Payload*\n${truncate(r.payloadPreview, 2500)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Evidence* (confidence ${(r.evidence.confidence * 100).toFixed(0)}%)\n${sources || "_no sources_"}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Rollback*\n${r.rollbackPlan}` },
    },
  ];

  if (decisionLines) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Decisions*\n${decisionLines}` },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `approval: \`${r.id}\`  •  run: \`${r.runId}\`  •  escalate \`${r.escalateAt}\`  •  expire \`${r.expiresAt}\`` },
    ],
  });

  // Buttons only shown while pending — once terminal, Slack update strips them.
  if (r.status === "pending") {
    blocks.push({
      type: "actions",
      block_id: "approval-actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Approve", emoji: true },
          action_id: `approval::approve::${r.id}`,
          value: r.id,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "Reject", emoji: true },
          action_id: `approval::reject::${r.id}`,
          value: r.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Ask", emoji: true },
          action_id: `approval::ask::${r.id}`,
          value: r.id,
        },
      ],
    });
  }

  return { text: fallbackText, blocks };
}

function iconFor(status: ApprovalRequest["status"]): string {
  switch (status) {
    case "pending":
      return "⏳";
    case "approved":
      return "✅";
    case "rejected":
      return "❌";
    case "expired":
      return "⌛";
    case "stood-down":
      return "🪂";
    default:
      return "•";
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 3)}...`;
}
