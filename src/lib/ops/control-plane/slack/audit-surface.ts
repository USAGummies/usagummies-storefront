/**
 * Slack surface for the audit log.
 *
 * Mirrors every autonomous write to `#ops-audit` as a one-line post.
 * Blueprint §15.2 (#ops-audit rules) + §15.4 T6 ("start posting all
 * agent writes to #ops-audit").
 *
 * Store is authoritative; Slack is a mirror. Mirror failure does not
 * invalidate the audit entry.
 */

import type { AuditSlackSurface } from "../audit";
import type { AuditLogEntry, ChannelId } from "../types";
import { getChannel } from "../channels";

import { postMessage } from "./client";

export class AuditSurface implements AuditSlackSurface {
  private readonly channelName: string;

  constructor(channelId: ChannelId = "ops-audit") {
    this.channelName = getChannel(channelId)?.name ?? "#ops-audit";
  }

  async mirror(entry: AuditLogEntry): Promise<void> {
    const text = renderAuditLine(entry);
    await postMessage({ channel: this.channelName, text });
  }
}

function renderAuditLine(entry: AuditLogEntry): string {
  const result = entry.result === "ok" ? "✓" : entry.result === "error" ? "✗" : entry.result === "stood-down" ? "↩︎" : "•";
  const entityRef = entry.entityId
    ? `${entry.entityType}:${entry.entityId}`
    : entry.entityType;
  const confidence =
    typeof entry.confidence === "number" ? ` conf=${entry.confidence.toFixed(2)}` : "";
  const approval = entry.approvalId ? ` approval=\`${entry.approvalId}\`` : "";
  const cites = entry.sourceCitations.length > 0
    ? ` sources=${entry.sourceCitations
        .map((s) => `${s.system}${s.id ? `:${s.id}` : ""}`)
        .slice(0, 3)
        .join(",")}${entry.sourceCitations.length > 3 ? "…" : ""}`
    : "";
  const err = entry.error ? ` err="${truncate(entry.error.message, 200)}"` : "";
  return [
    `${result} \`${entry.division}\` \`${entry.actorType}:${entry.actorId}\``,
    `→ \`${entry.action}\` ${entityRef}${confidence}${approval}${cites}${err}`,
    `[run \`${entry.runId}\` • ${entry.createdAt}]`,
  ].join(" ");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 3)}...`;
}
