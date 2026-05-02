/**
 * Slack Block Kit renderer for the `proposals` command.
 *
 * Pure module — takes an `ExternalProposalsSummary` (already aggregated
 * by `summarizeExternalProposals`) and renders a compact Block Kit
 * card per blueprint §5 standard.
 *
 * Card shape:
 *   1. Header: "🎁 External proposals"
 *   2. Stats fields: total / queued / promoted / flagged
 *   3. Brief: "what this means" copy (esp. flagged direct mutations)
 *   4. Top queued (up to 5): source · risk class · title · evidence claim
 *   5. By-source + by-department chips
 *   6. Context: "no external tool executes directly" reminder + degraded
 *   7. Actions: "Open proposals dashboard"
 */
import type {
  ExternalProposalRecord,
  ExternalProposalsSummary,
} from "./external-proposals";

const DASHBOARD_URL = "https://www.usagummies.com/api/ops/external-proposals";

export interface ExternalProposalsCard {
  text: string;
  blocks: unknown[];
}

export function renderExternalProposalsCard(args: {
  summary: ExternalProposalsSummary;
  degraded?: ReadonlyArray<string>;
  generatedAt?: string;
}): ExternalProposalsCard {
  const { summary } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  const text =
    summary.total === 0
      ? "🎁 External proposals — empty"
      : `🎁 External proposals — ${summary.queued} queued · ${summary.flaggedDirectMutation} flagged · ${summary.total} total`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🎁 External proposals",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total*\n${summary.total}` },
        { type: "mrkdwn", text: `*Queued*\n${summary.queued}` },
        { type: "mrkdwn", text: `*Promoted*\n${summary.promoted}` },
        {
          type: "mrkdwn",
          text: `*🚩 Direct-mutation*\n${summary.flaggedDirectMutation}`,
        },
        { type: "mrkdwn", text: `*Reviewed*\n${summary.reviewed}` },
        { type: "mrkdwn", text: `*Rejected*\n${summary.rejected}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: buildBriefText(summary) },
    },
  ];

  if (summary.topQueued.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Top ${summary.topQueued.length} queued proposals*\n` +
          summary.topQueued.map(formatQueuedRow).join("\n"),
      },
    });
  }

  const sourceChips = formatChipRow(summary.bySource);
  const deptChips = formatChipRow(summary.byDepartment);
  if (sourceChips || deptChips) {
    blocks.push({
      type: "section",
      fields: [
        ...(sourceChips
          ? [{ type: "mrkdwn", text: `*By source*\n${sourceChips}` }]
          : []),
        ...(deptChips
          ? [{ type: "mrkdwn", text: `*By department*\n${deptChips}` }]
          : []),
      ],
    });
  }

  const contextLines: string[] = [
    `Generated ${formatShortTime(generatedAt)} · Read-only — no external tool executes directly`,
  ];
  if (args.degraded && args.degraded.length > 0) {
    contextLines.push(`:warning: Degraded: ${args.degraded.join(" · ")}`);
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
        text: {
          type: "plain_text",
          text: "Open proposals dashboard",
          emoji: true,
        },
        url: DASHBOARD_URL,
        action_id: "open_external_proposals",
      },
    ],
  });

  return { text, blocks };
}

function buildBriefText(s: ExternalProposalsSummary): string {
  if (s.total === 0) {
    return "_No external proposals yet — Polsia, Sola, Reevo, OpenAI workspace agents, and Claude Code/Codex post here when they have something to suggest._";
  }
  const parts: string[] = [];
  if (s.flaggedDirectMutation > 0) {
    parts.push(
      `*🚩 ${s.flaggedDirectMutation} proposal${s.flaggedDirectMutation === 1 ? "" : "s"} claim direct mutation* — auto-downgraded to \`approval_required\`. Promotion still goes through the canonical Class B/C approval flow.`,
    );
  }
  if (s.queued > 0) {
    parts.push(
      `*${s.queued} queued* — review + promote / reject from the dashboard.`,
    );
  }
  if (s.queued === 0 && s.total > 0) {
    parts.push(
      "_All proposals have been reviewed. Promote rate visible on the dashboard._",
    );
  }
  return parts.join(" ");
}

function formatQueuedRow(r: ExternalProposalRecord): string {
  const flagBadge = r.flags.includes("claims_direct_mutation") ? " 🚩" : "";
  const conf = r.evidence.confidence
    ? ` · ${(r.evidence.confidence * 100).toFixed(0)}% conf`
    : "";
  return `• \`${r.source}\` · ${r.riskClass}${flagBadge} — ${truncate(r.title, 80)}${conf}`;
}

function formatChipRow(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";
  return entries
    .slice(0, 5)
    .map(([k, n]) => `\`${k}\` · ${n}`)
    .join(" · ");
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
