/**
 * Slack Block Kit renderer for workpack result + failure cards.
 *
 * Build 6 close-out per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md §4
 * — "result cards back into Slack threads." When an operator updates
 * a workpack to `done` (or `failed`), the PATCH route posts a result
 * card back to the original Slack thread so the requester sees the
 * completion in-context, not buried in `/ops/workpacks`.
 *
 * Pure renderer — no I/O. The route layer decides when to call.
 *
 * Doctrine compliance (per /contracts/slack-card-doctrine.md):
 *   - Read-only — the card has link buttons only, no destructive verbs.
 *   - Read-only context note pinned: "Workpack execution stayed
 *     external — no Gmail/HubSpot/QBO/Shopify/checkout fired."
 */
import type {
  WorkpackRecord,
  WorkpackStatus,
} from "./workpacks";

const DASHBOARD_URL = "https://www.usagummies.com/ops/workpacks";

export interface WorkpackResultCard {
  text: string;
  blocks: unknown[];
}

/**
 * Render a result/failure card. Returns null when the record's
 * status is not `done` or `failed` — the route uses null as the
 * signal to skip the post.
 */
export function renderWorkpackResultCard(
  record: WorkpackRecord,
): WorkpackResultCard | null {
  if (record.status !== "done" && record.status !== "failed") return null;

  const headerEmoji = record.status === "done" ? "✅" : "🛑";
  const headerLabel = record.status === "done" ? "Workpack done" : "Workpack failed";
  const text = `${headerEmoji} ${headerLabel} — ${record.title}`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${headerEmoji} ${headerLabel}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Workpack*\n\`${record.id}\`` },
        { type: "mrkdwn", text: `*Department*\n${record.department}` },
        { type: "mrkdwn", text: `*Intent*\n${record.intent}` },
        { type: "mrkdwn", text: `*Risk*\n${record.riskClass}` },
        ...(record.assignedTo
          ? [{ type: "mrkdwn", text: `*Assigned*\n${record.assignedTo}` }]
          : []),
        {
          type: "mrkdwn",
          text: `*Status*\n${formatStatusLabel(record.status)}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: buildBriefText(record),
      },
    },
  ];

  if (record.resultLinks && record.resultLinks.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Result links*\n" +
          record.resultLinks
            .slice(0, 5)
            .map((url) => `• <${url}>`)
            .join("\n"),
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text:
          "Read-only — workpack execution stayed external. No Gmail / HubSpot / QBO / Shopify / checkout fired from this card.",
      },
    ],
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open workpack", emoji: true },
        url: `${DASHBOARD_URL}#${encodeURIComponent(record.id)}`,
        action_id: "open_workpack",
      },
      ...(record.sourceUrl
        ? [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Source thread",
                emoji: true,
              },
              url: record.sourceUrl,
              action_id: "open_workpack_source",
            },
          ]
        : []),
    ],
  });

  return { text, blocks };
}

function buildBriefText(record: WorkpackRecord): string {
  if (record.status === "done") {
    if (record.resultSummary && record.resultSummary.trim().length > 0) {
      return `*${truncate(record.resultSummary, 600)}*`;
    }
    return "_Marked done — no result summary attached._";
  }
  // failed
  if (record.failureReason && record.failureReason.trim().length > 0) {
    return `:warning: ${truncate(record.failureReason, 600)}`;
  }
  return "_Marked failed — no failure reason attached._";
}

function formatStatusLabel(s: WorkpackStatus): string {
  if (s === "done") return "✅ done";
  if (s === "failed") return "🛑 failed";
  return s;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
