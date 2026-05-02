/**
 * Slack Block Kit renderer for the `email queue` command.
 *
 * Pure module: takes an `EmailAgentQueueSummary` (already aggregated by
 * `summarizeEmailAgentQueue`) and renders a compact Block Kit card.
 * No I/O. Easy to test.
 *
 * Card shape (per blueprint §5):
 *   1. Header: "📬 Email queue"
 *   2. Section fields: total / classified / backlog / whales
 *   3. Brief block: "What this means" — backlog interpretation
 *   4. Top rows section (up to 5 entries, truncated to 80 chars each)
 *   5. Context block: source doctrine ref + truncation flag if relevant
 *   6. Actions block: "Open dashboard" → /ops/email-agents
 */
import type {
  EmailAgentQueueRow,
  EmailAgentQueueSummary,
} from "./email-agent-queue";

const DASHBOARD_URL = "https://www.usagummies.com/ops/email-agents";
const MAX_ROW_TEXT = 80;

export interface EmailQueueCard {
  text: string;
  blocks: unknown[];
}

export function renderEmailQueueCard(args: {
  summary: EmailAgentQueueSummary;
  truncated?: boolean;
  degraded?: ReadonlyArray<string>;
  generatedAt?: string;
}): EmailQueueCard {
  const { summary, truncated, degraded } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  const text =
    summary.total === 0
      ? "📬 Email queue is empty"
      : `📬 Email queue — ${summary.total} total · ${summary.byStatus.classified} classified · ${summary.backlogReceived} backlog`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "📬 Email queue", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total*\n${summary.total}` },
        { type: "mrkdwn", text: `*Classified*\n${summary.byStatus.classified}` },
        {
          type: "mrkdwn",
          text: `*Backlog (received)*\n${summary.backlogReceived}`,
        },
        { type: "mrkdwn", text: `*🐳 Whales*\n${summary.whaleCount}` },
        { type: "mrkdwn", text: `*Noise*\n${summary.byStatus.received_noise}` },
        {
          type: "mrkdwn",
          text: `*Categories*\n${formatCategoryCounts(summary.byCategory)}`,
        },
      ],
    },
  ];

  // Brief block
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: buildBriefText(summary),
    },
  });

  // Top rows
  if (summary.topRows.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Top ${summary.topRows.length} actionable rows*\n` +
          summary.topRows.map(formatTopRow).join("\n"),
      },
    });
  }

  // Context: doctrine + degraded + truncation
  const contextLines: string[] = [
    `Generated ${formatShortTime(generatedAt)} · Read-only roll-up over Phase 37.1+37.2 KV records`,
  ];
  if (truncated) {
    contextLines.push(":warning: Scan was truncated — partial queue.");
  }
  if (degraded && degraded.length > 0) {
    contextLines.push(`:warning: Degraded: ${degraded.join(" · ")}`);
  }
  blocks.push({
    type: "context",
    elements: contextLines.map((t) => ({ type: "mrkdwn", text: t })),
  });

  // Actions
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Open email-agents dashboard",
          emoji: true,
        },
        url: DASHBOARD_URL,
        action_id: "open_email_agents_dashboard",
      },
    ],
  });

  return { text, blocks };
}

function buildBriefText(summary: EmailAgentQueueSummary): string {
  if (summary.total === 0) {
    return "_No queue rows yet — scanner has not written any records since the last KV TTL window._";
  }
  if (summary.backlogReceived === 0 && summary.byStatus.classified === 0) {
    return "_Only noise in the queue right now — classifier has nothing actionable to draft on._";
  }
  if (summary.whaleCount > 0) {
    return `*🐳 ${summary.whaleCount} whale-class record${summary.whaleCount === 1 ? "" : "s"} in queue.* Drafting on whale rows is HARD-blocked at the §2.5 approval gate.`;
  }
  if (summary.backlogReceived > 0) {
    return `*${summary.backlogReceived} record${summary.backlogReceived === 1 ? "" : "s"} waiting on the classifier.* If this number grows over multiple checks, the classifier may be degraded.`;
  }
  return `_${summary.byStatus.classified} classified record${summary.byStatus.classified === 1 ? "" : "s"} ready for the next stage._`;
}

function formatTopRow(row: EmailAgentQueueRow): string {
  const subject = truncate(row.subject || "(no subject)", MAX_ROW_TEXT);
  const status = row.category ? `${row.category}` : row.status;
  return `• \`${row.fromEmail}\` — ${subject} _(${status})_`;
}

function formatCategoryCounts(byCategory: Record<string, number>): string {
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "—";
  const top = entries.slice(0, 3);
  return top.map(([cat, n]) => `${cat} · ${n}`).join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
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
