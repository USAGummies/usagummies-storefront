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
import { shouldMirror } from "./mirror-dedup";

/**
 * Per-action TTL (seconds) for the Slack-mirror dedup. Audit STORE
 * remains authoritative — these TTLs only suppress redundant Slack
 * mirrors of the same `(action, actor, entity)` event.
 *
 * Default = 1h (matches the typical sweep cadence). Sweep-class actions
 * that fire repeatedly against the same entity get 24h.
 */
const MIRROR_TTL_BY_ACTION_PREFIX: ReadonlyArray<readonly [string, number]> = [
  // approval-expiry-sweeper escalates the same approval every hour →
  // mirror once per day per approval, store keeps the full hourly trail.
  ["approval.sweep.", 86_400],
  // operating-memory drift sweep — same drift surfaces hourly until fixed.
  ["memory.drift.", 86_400],
  // fulfillment-drift-audit weekly — same artifact resurfaces.
  ["fulfillment.drift.", 86_400],
];

const DEFAULT_MIRROR_TTL_SECONDS = 3_600;

function ttlForAction(action: string): number {
  for (const [prefix, ttl] of MIRROR_TTL_BY_ACTION_PREFIX) {
    if (action.startsWith(prefix)) return ttl;
  }
  return DEFAULT_MIRROR_TTL_SECONDS;
}

export class AuditSurface implements AuditSlackSurface {
  private readonly channelRef: string;

  constructor(channelId: ChannelId = "ops-audit") {
    const channel = getChannel(channelId);
    this.channelRef = channel?.slackChannelId ?? channel?.name ?? "#ops-audit";
  }

  async mirror(entry: AuditLogEntry): Promise<void> {
    // Dedup: same (action, actor, entityType, entityId, division) within
    // TTL → skip the Slack mirror. Audit store still has the full record.
    const fingerprint: ReadonlyArray<string> = [
      entry.action,
      `${entry.actorType}:${entry.actorId}`,
      entry.entityType,
      entry.entityId ?? "",
      entry.division,
    ];
    const ok = await shouldMirror({
      fingerprint,
      ttlSeconds: ttlForAction(entry.action),
      namespace: "slack-mirror-dedup:v1:audit",
    });
    if (!ok) return; // dedup skip — store is authoritative
    const text = renderAuditLine(entry);
    await postMessage({ channel: this.channelRef, text });
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
