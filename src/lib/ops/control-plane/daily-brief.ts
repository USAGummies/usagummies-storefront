/**
 * Daily brief composer.
 *
 * Blueprint §15.4 W3a: "Turn on recurring daily brief cadence — 7 AM PT
 * morning brief + 6 PM PT EOD wrap — in #ops-daily via a Make.com
 * scenario referencing src/app/api/ops/daily-brief."
 *
 * Scope — day-one: the composer reports **control-plane state** that we
 * already have authoritative access to (open approvals, paused agents,
 * recent audit activity, active-division roster, most-recent weekly
 * drift-audit scorecard summary).
 *
 * External revenue sources (Shopify, Amazon SP-API, Faire, Plaid,
 * HubSpot) are NOT wired here yet — the brief either shows a real
 * number from a live query when the integration is provided by the
 * caller, or it says "unavailable" with the reason. Per blueprint
 * non-negotiable #2: never fabricate figures.
 *
 * The composer is pure (input → text). The route fetches and the
 * composer renders. Tests exercise render-only paths deterministically.
 */

import type { ApprovalRequest, AuditLogEntry } from "./types";
import type { PausedAgentRecord } from "./enforcement";

export type BriefKind = "morning" | "eod";

export interface RevenueLine {
  /** "Shopify DTC", "Amazon", "Faire", etc. */
  channel: string;
  /** Dollar amount in USD, or null if unavailable. Never NaN. */
  amountUsd: number | null;
  /** If amountUsd is null, why. Short human-readable. */
  unavailableReason?: string;
  /** Live source id/url so humans can verify — required when amountUsd is non-null. */
  source?: { system: string; id?: string; retrievedAt: string };
}

export interface BriefInput {
  kind: BriefKind;
  /** Timestamp the brief is "as of". */
  asOf: Date;
  /**
   * Active divisions (from the registry). Used to show division health
   * + open-approval routing in the brief.
   */
  activeDivisions: Array<{ id: string; name: string; humanOwner: string }>;
  /** Open pending approvals, typically from approvalStore().listPending(). */
  pendingApprovals: ApprovalRequest[];
  /** Currently paused agents from the PauseSink. */
  pausedAgents: PausedAgentRecord[];
  /**
   * Recent audit entries from auditStore().recent(N) — used to compute
   * activity volume per division in the last 24h.
   */
  recentAudit: AuditLogEntry[];
  /**
   * Most recent weekly drift-audit scorecard summary line if any. The
   * caller constructs this by searching recent audit for entries with
   * action="drift-audit.scorecard" and picking the newest.
   */
  lastDriftAuditSummary?: string;
  /**
   * Yesterday's revenue by channel. Caller supplies; composer does NOT
   * fabricate. Every channel either has a real amountUsd + source or
   * an unavailableReason.
   */
  revenueYesterday?: RevenueLine[];
  /**
   * Cash position from Plaid (BoA checking 7020 primary). Same rule —
   * live number + source or explicit unavailableReason.
   */
  cashPosition?: {
    amountUsd: number | null;
    unavailableReason?: string;
    source?: { system: string; retrievedAt: string };
  };
  /** Any degradations to call out at the top of the brief. */
  degradations?: string[];
}

export interface BriefOutput {
  text: string; // Slack-flavored markdown, fallback / mobile-friendly
  blocks: unknown[]; // Slack Block Kit for richer rendering
  meta: {
    kind: BriefKind;
    asOf: string;
    pendingApprovalCount: number;
    pausedAgentCount: number;
    activityLast24h: number;
    degraded: boolean;
  };
}

// ----- Composer ---------------------------------------------------------

export function composeDailyBrief(input: BriefInput): BriefOutput {
  const asOfIso = input.asOf.toISOString();
  const kindLabel = input.kind === "morning" ? "Morning brief" : "End-of-day wrap";
  const pendingCount = input.pendingApprovals.length;
  const pausedCount = input.pausedAgents.length;
  const degraded = (input.degradations ?? []).length > 0;

  const activityByDivision = countByDivision(input.recentAudit, input.asOf);

  const fallbackText = `${kindLabel} — ${asOfIso} — ${pendingCount} pending approval(s), ${pausedCount} paused agent(s)${degraded ? " — DEGRADED" : ""}`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🇺🇸 ${kindLabel}`, emoji: true },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*As of:* \`${asOfIso}\`  •  *kind:* \`${input.kind}\`` },
      ],
    },
  ];

  // Degraded banner goes first so readers can't miss it.
  if (degraded) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⚠️ *Degraded brief* — the following data sources were unavailable or unpopulated:\n${(input.degradations ?? []).map((d) => `• ${d}`).join("\n")}`,
      },
    });
  }

  // ---- Priorities: pending approvals + paused agents ----
  const priorities: string[] = [];
  priorities.push(
    pendingCount > 0
      ? `*${pendingCount}* pending approval(s) in \`#ops-approvals\` — see breakdown below.`
      : `*0* pending approvals.`,
  );
  if (pausedCount > 0) {
    const agentList = input.pausedAgents.map((p) => `\`${p.agentId}\``).join(", ");
    priorities.push(`🛑 *${pausedCount}* paused agent(s) require review: ${agentList}.`);
  }
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Priorities*\n${priorities.join("\n")}` },
  });

  // ---- Revenue yesterday ----
  if (input.revenueYesterday && input.revenueYesterday.length > 0) {
    const rows = input.revenueYesterday
      .map((r) => {
        if (r.amountUsd != null) {
          const srcParts = r.source
            ? [r.source.system, r.source.id, r.source.retrievedAt].filter((x): x is string => !!x)
            : [];
          const src = srcParts.length > 0 ? ` _(${srcParts.join(", ")})_` : "";
          return `• *${r.channel}:* $${r.amountUsd.toFixed(2)}${src}`;
        }
        return `• *${r.channel}:* unavailable — ${r.unavailableReason ?? "no reason given"}`;
      })
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Revenue (yesterday)*\n${rows}` },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Revenue (yesterday)*\n_External revenue integrations not wired into the brief yet (Shopify / Amazon / Faire). Per blueprint non-negotiable #2, this is shown as unavailable rather than fabricated._`,
      },
    });
  }

  // ---- Cash position ----
  if (input.cashPosition) {
    if (input.cashPosition.amountUsd != null) {
      const src = input.cashPosition.source
        ? ` _(${input.cashPosition.source.system}, ${input.cashPosition.source.retrievedAt})_`
        : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Cash (BoA checking 7020)*  $${input.cashPosition.amountUsd.toFixed(2)}${src}`,
        },
      });
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Cash (BoA checking 7020)*  unavailable — ${input.cashPosition.unavailableReason ?? "no reason given"}`,
        },
      });
    }
  }

  // ---- Pending approvals breakdown ----
  if (pendingCount > 0) {
    const grouped = groupApprovalsByDivision(input.pendingApprovals);
    const lines = Object.entries(grouped)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .map(([division, reqs]) => {
        const preview = reqs
          .slice(0, 3)
          .map((r) => `    - \`${r.action}\` (class ${r.class}, approvers: ${r.requiredApprovers.join(",")})`)
          .join("\n");
        return `• *${division}* (${reqs.length}):\n${preview}`;
      })
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Pending approvals by division*\n${lines}` },
    });
  }

  // ---- Activity (audit entries last 24h) ----
  const totalActivity = Object.values(activityByDivision).reduce((a, b) => a + b, 0);
  if (totalActivity > 0) {
    const rows = Object.entries(activityByDivision)
      .sort((a, b) => b[1] - a[1])
      .map(([division, count]) => `• *${division}:* ${count}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Audit activity (last 24h)*\n${rows}` },
    });
  }

  // ---- Active divisions roster (always shown for orientation) ----
  const divisionRoster = input.activeDivisions
    .map((d) => `• *${d.name}* — ${d.humanOwner}`)
    .join("\n");
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Active divisions*\n${divisionRoster}` },
  });

  // ---- Last drift audit summary ----
  if (input.lastDriftAuditSummary) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*Last drift audit:* ${input.lastDriftAuditSummary}` },
      ],
    });
  }

  return {
    text: fallbackText,
    blocks,
    meta: {
      kind: input.kind,
      asOf: asOfIso,
      pendingApprovalCount: pendingCount,
      pausedAgentCount: pausedCount,
      activityLast24h: totalActivity,
      degraded,
    },
  };
}

// ----- Helpers ----------------------------------------------------------

function countByDivision(entries: AuditLogEntry[], asOf: Date): Record<string, number> {
  const cutoff = asOf.getTime() - 24 * 3_600_000;
  const out: Record<string, number> = {};
  for (const e of entries) {
    if (new Date(e.createdAt).getTime() < cutoff) continue;
    out[e.division] = (out[e.division] ?? 0) + 1;
  }
  return out;
}

function groupApprovalsByDivision(reqs: ApprovalRequest[]): Record<string, ApprovalRequest[]> {
  const out: Record<string, ApprovalRequest[]> = {};
  for (const r of reqs) {
    if (!out[r.division]) out[r.division] = [];
    out[r.division].push(r);
  }
  return out;
}
