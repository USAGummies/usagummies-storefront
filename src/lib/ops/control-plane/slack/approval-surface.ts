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
  const target = targetLabel(r);
  const sources = r.evidence.sources
    .slice(0, 5)
    .map((s) => {
      const parts = [s.system];
      if (s.id) parts.push(s.id);
      return `• ${parts.join(":")} · ${s.retrievedAt}${s.url ? ` · ${s.url}` : ""}`;
    })
    .join("\n");
  const hiddenSources = Math.max(0, r.evidence.sources.length - 5);
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
      text: { type: "plain_text", text: `${icon} ${statusTitle(r.status)} · ${r.action}`, emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*${classLabel}* · approver: *${approvers}* · target: *${target}*`,
        },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Status*\n${statusLabel(r.status)}` },
        { type: "mrkdwn", text: `*Risk gate*\n${classLabel}` },
        { type: "mrkdwn", text: `*Owner*\n${approvers}` },
        { type: "mrkdwn", text: `*Agent / run*\n${r.actorAgentId} · ${shortId(r.runId)}` },
        { type: "mrkdwn", text: `*System*\n${r.targetSystem}` },
        { type: "mrkdwn", text: `*Entity*\n${target}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Decision brief*\n${truncate(r.evidence.claim, 900)}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*What will happen if approved*\n${formatPayloadPreview(r.payloadPreview)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Evidence* · confidence ${(r.evidence.confidence * 100).toFixed(0)}%`,
          sources || "_no sources_",
          hiddenSources ? `_+${hiddenSources} more source${hiddenSources === 1 ? "" : "s"} in the stored payload_` : "",
        ].filter(Boolean).join("\n"),
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Safety / rollback*\n${truncate(r.rollbackPlan, 700)}` },
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
      { type: "mrkdwn", text: `approval \`${r.id}\` · run \`${r.runId}\` · escalates \`${r.escalateAt}\` · expires \`${r.expiresAt}\`` },
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
          text: { type: "plain_text", text: "Needs edit", emoji: true },
          action_id: `approval::ask::${r.id}`,
          value: r.id,
        },
      ],
    });
  }

  return { text: fallbackText, blocks };
}

function targetLabel(r: ApprovalRequest): string {
  const entity = r.targetEntity;
  if (!entity) return r.targetSystem;
  return entity.label ?? entity.id ?? entity.type;
}

function shortId(id: string): string {
  return id.length > 12 ? `…${id.slice(-12)}` : id;
}

function statusTitle(status: ApprovalRequest["status"]): string {
  switch (status) {
    case "pending":
      return "Needs decision";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "stood-down":
      return "Stood down";
    case "draft":
      return "Draft";
    default:
      return status;
  }
}

function statusLabel(status: ApprovalRequest["status"]): string {
  return `${iconFor(status)} ${statusTitle(status)} (${status})`;
}

function formatPayloadPreview(payload: string): string {
  const normalized = payload.trim();
  if (!normalized) return "_no payload preview_";
  const truncated = truncate(normalized, 1400);
  if (truncated.includes("\n") || truncated.includes("{") || truncated.includes(":")) {
    return `\`\`\`${truncated}\`\`\``;
  }
  return truncated;
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
