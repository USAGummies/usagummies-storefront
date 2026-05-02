/**
 * Slack Block Kit renderer for the `what needs ben` master card.
 *
 * Pure module — takes a `WhatNeedsBenSummary` and renders the master
 * cross-department posture card per blueprint §5 standard.
 *
 * Card shape:
 *   1. Header: "🇺🇸 What needs Ben — <posture>"
 *   2. Top recommendation block (the priority lane + CTA)
 *   3. 6-lane status fields (each with chip + 1-line summary)
 *   4. Counts: red / yellow / green / unknown
 *   5. Context (read-only note + degraded)
 *   6. Actions: "Run sales today" / "Run all" buttons
 */
import type {
  LanePosture,
  LaneStatus,
  WhatNeedsBenSummary,
} from "./what-needs-ben";

const DASHBOARD_URL = "https://www.usagummies.com/ops/today";

export interface WhatNeedsBenCard {
  text: string;
  blocks: unknown[];
}

export function renderWhatNeedsBenCard(args: {
  summary: WhatNeedsBenSummary;
}): WhatNeedsBenCard {
  const { summary } = args;
  const postureEmoji = postureLabel(summary.posture);

  const text = formatTopLine(summary, postureEmoji);

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🇺🇸 What needs Ben — ${postureEmoji}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: summary.recommendation.text },
    },
    {
      type: "section",
      fields: summary.lanes.map((l) => ({
        type: "mrkdwn",
        text: `${laneIcon(l.posture)} *${l.label}*\n${l.summary}\n_\`${l.slashCommand}\`_`,
      })),
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Counts:* 🔴 ${summary.counts.red} · 🟡 ${summary.counts.yellow} · 🟢 ${summary.counts.green} · ⚪️ ${summary.counts.unknown}`,
        },
      ],
    },
  ];

  const contextLines: string[] = [
    `Generated ${formatShortTime(summary.generatedAt)} · Read-only — no execution fires from this card`,
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
        text: { type: "plain_text", text: "Open today dashboard", emoji: true },
        url: DASHBOARD_URL,
        action_id: "open_today_dashboard",
      },
    ],
  });

  return { text, blocks };
}

function formatTopLine(
  s: WhatNeedsBenSummary,
  postureEmoji: string,
): string {
  if (s.posture === "green") {
    return `🇺🇸 What needs Ben — ${postureEmoji} clean across all lanes`;
  }
  if (s.posture === "unknown") {
    return `🇺🇸 What needs Ben — ${postureEmoji} some lanes unavailable`;
  }
  if (!s.recommendation.laneId) {
    return `🇺🇸 What needs Ben — ${postureEmoji}`;
  }
  return `🇺🇸 What needs Ben — ${postureEmoji} → start with ${s.recommendation.laneId}`;
}

function postureLabel(p: LanePosture): string {
  if (p === "green") return "🟢 clean";
  if (p === "yellow") return "🟡 work waiting";
  if (p === "red") return "🔴 attention";
  return "⚪️ partial";
}

function laneIcon(p: LanePosture): string {
  if (p === "green") return "🟢";
  if (p === "yellow") return "🟡";
  if (p === "red") return "🔴";
  return "⚪️";
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

// Re-export LaneStatus for callers that build cards from external data.
export type { LaneStatus };
