/**
 * Slack Block Kit renderer for the `finance today` command.
 *
 * Pure module: takes a `FinanceTodaySummary` and renders a compact
 * Block Kit card per blueprint §5 standard:
 *   1. Header: "💵 Finance today"
 *   2. Posture chip (green/yellow/red) in the header line
 *   3. Section fields: pending / draft eligible / rene-approved / oldest age
 *   4. Brief: "What this means" — actionable guidance
 *   5. Top packets (up to 5)
 *   6. Oldest pending approvals (up to 3)
 *   7. Context: source links
 *   8. Actions: Open review / Open packets dashboards
 */
import type { FinancePacketRow, FinanceTodaySummary } from "./finance-today";

export interface FinanceTodayCard {
  text: string;
  blocks: unknown[];
}

const REVIEW_URL = "https://www.usagummies.com/ops/finance/review";
const PACKETS_URL =
  "https://www.usagummies.com/ops/finance/review-packets";

export function renderFinanceTodayCard(args: {
  summary: FinanceTodaySummary;
  generatedAt?: string;
}): FinanceTodayCard {
  const { summary } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  const postureEmoji = postureLabel(summary.posture);
  const text =
    summary.pendingFinanceApprovals === 0 && summary.draftEligiblePackets === 0
      ? `💵 Finance today — ${postureEmoji} clean`
      : `💵 Finance today — ${postureEmoji} ${summary.pendingFinanceApprovals} pending · ${summary.draftEligiblePackets} eligible drafts`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `💵 Finance today — ${postureEmoji}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Pending approvals*\n${summary.pendingFinanceApprovals}`,
        },
        {
          type: "mrkdwn",
          text: `*Receipt promote*\n${summary.pendingPromote}`,
        },
        {
          type: "mrkdwn",
          text: `*Draft + eligible*\n${summary.draftEligiblePackets}`,
        },
        {
          type: "mrkdwn",
          text: `*Rene-approved*\n${summary.reneApprovedPackets}`,
        },
        {
          type: "mrkdwn",
          text: `*Rejected*\n${summary.rejectedPackets}`,
        },
        {
          type: "mrkdwn",
          text: `*Oldest pending*\n${formatOldestAge(summary)}`,
        },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: buildBriefText(summary) },
    },
  ];

  if (summary.topPackets.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Top ${summary.topPackets.length} packets*\n` +
          summary.topPackets.map(formatPacketRow).join("\n"),
      },
    });
  }

  if (summary.oldestPendingApprovals.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Oldest pending approvals*\n` +
          summary.oldestPendingApprovals
            .slice(0, 3)
            .map(
              (a) =>
                `• \`${a.id.slice(0, 14)}\` · ${truncate(a.action, 70)} _(${a.ageDays}d old)_`,
            )
            .join("\n"),
      },
    });
  }

  const contextLines: string[] = [
    `Generated ${formatShortTime(generatedAt)} · Read-only — no QBO write fires from this card`,
  ];
  if (summary.degraded.length > 0) {
    contextLines.push(`:warning: Degraded: ${summary.degraded.join(" · ")}`);
  }
  blocks.push({
    type: "context",
    elements: contextLines.map((t) => ({ type: "mrkdwn", text: t })),
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open review queue", emoji: true },
        url: REVIEW_URL,
        action_id: "open_finance_review",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Open review packets", emoji: true },
        url: PACKETS_URL,
        action_id: "open_finance_review_packets",
      },
    ],
  });

  return { text, blocks };
}

function buildBriefText(s: FinanceTodaySummary): string {
  if (
    s.pendingFinanceApprovals === 0 &&
    s.draftEligiblePackets === 0 &&
    s.reneApprovedPackets === 0
  ) {
    return "_Clean queue. No receipts waiting on Rene; no Rene-approved packets queued for QBO._";
  }
  const parts: string[] = [];
  if (s.posture === "red") {
    parts.push(
      "*🚨 Stale approval (≥3 days old).* Promote or stand down — the doctrine clock is up.",
    );
  }
  if (s.pendingPromote > 0) {
    parts.push(
      `*${s.pendingPromote} receipt-promote approval${s.pendingPromote === 1 ? "" : "s"} waiting on Rene.*`,
    );
  }
  if (s.draftEligiblePackets > 0) {
    parts.push(
      `*${s.draftEligiblePackets} eligible draft packet${s.draftEligiblePackets === 1 ? "" : "s"}* — operator can promote in <\`${REVIEW_URL}|review queue>\\>.`,
    );
  }
  if (s.reneApprovedPackets > 0) {
    parts.push(
      `*${s.reneApprovedPackets} Rene-approved packet${s.reneApprovedPackets === 1 ? "" : "s"}* — eligible for the deferred \`qbo.bill.create\` step (separate Class B).`,
    );
  }
  if (s.rejectedPackets > 0) {
    parts.push(
      `*${s.rejectedPackets} rejected packet${s.rejectedPackets === 1 ? "" : "s"}* — review reason in the packet detail view.`,
    );
  }
  return parts.join(" ");
}

function formatPacketRow(r: FinancePacketRow): string {
  const vendor = r.vendor ?? "(no vendor)";
  const amount = r.amount === null ? "(no amount)" : `$${r.amount.toFixed(2)}`;
  const warn = r.warnings > 0 ? ` ⚠️${r.warnings}` : "";
  return `• \`${r.packetId.slice(0, 18)}\` ${vendor} · ${amount} _(${r.status}${warn})_`;
}

function formatOldestAge(s: FinanceTodaySummary): string {
  if (s.oldestPendingApprovals.length === 0) return "—";
  return `${s.oldestPendingApprovals[0].ageDays}d`;
}

function postureLabel(p: FinanceTodaySummary["posture"]): string {
  if (p === "green") return "🟢 clean";
  if (p === "yellow") return "🟡 work waiting";
  return "🔴 stale";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(11, 16) + "Z";
  } catch {
    return iso;
  }
}
