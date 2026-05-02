/**
 * Slack Block Kit renderer for the `marketing today` command.
 *
 * Pure module — takes `MarketingTodaySummary` (already rolled up by
 * `summarizeMarketingToday`) and renders a compact Block Kit card per
 * blueprint §5 standard.
 *
 * Card shape:
 *   1. Header with posture chip
 *   2. 6-field stats grid (spend / revenue / ROAS / active campaigns /
 *      configured platforms / pending approvals)
 *   3. Brief — "what this means" copy
 *   4. Per-platform table (status + spend/revenue/ROAS per platform)
 *   5. Blockers section (if any)
 *   6. Oldest pending approvals (if any)
 *   7. Context block — generation time + degraded
 *   8. Actions — Open marketing dashboard
 */
import type {
  MarketingPlatformId,
  MarketingPlatformStatus,
  MarketingPlatformSummary,
  MarketingTodaySummary,
} from "./marketing-today";

const DASHBOARD_URL = "https://www.usagummies.com/ops/marketing";

export interface MarketingTodayCard {
  text: string;
  blocks: unknown[];
}

export function renderMarketingTodayCard(args: {
  summary: MarketingTodaySummary;
}): MarketingTodayCard {
  const { summary } = args;
  const postureEmoji = postureLabel(summary.posture);

  const text = formatTopLine(summary, postureEmoji);

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📣 Marketing today — ${postureEmoji}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Spend (30d)*\n$${summary.totals.spend30d.toFixed(2)}`,
        },
        {
          type: "mrkdwn",
          text: `*Revenue (30d)*\n$${summary.totals.revenue30d.toFixed(2)}`,
        },
        {
          type: "mrkdwn",
          text: `*ROAS (30d)*\n${summary.totals.roas30d.toFixed(2)}x`,
        },
        {
          type: "mrkdwn",
          text: `*Active campaigns*\n${summary.totals.activeCampaigns}`,
        },
        {
          type: "mrkdwn",
          text: `*Configured platforms*\n${summary.totals.configuredPlatforms}/3`,
        },
        {
          type: "mrkdwn",
          text: `*Pending approvals*\n${summary.pendingApprovals}`,
        },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: buildBriefText(summary) },
    },
  ];

  if (summary.platforms.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Platforms*\n` +
          summary.platforms.map(formatPlatformRow).join("\n"),
      },
    });
  }

  if (summary.blockers.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*🚧 Blockers*\n` +
          summary.blockers
            .map((b) => `• \`${b.platform}\` — ${b.reason}`)
            .join("\n"),
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
    `Generated ${formatShortTime(summary.generatedAt)} · Read-only — no ad spend / creative publish fires from this card`,
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
        text: {
          type: "plain_text",
          text: "Open marketing dashboard",
          emoji: true,
        },
        url: DASHBOARD_URL,
        action_id: "open_marketing_dashboard",
      },
    ],
  });

  return { text, blocks };
}

function formatTopLine(
  summary: MarketingTodaySummary,
  postureEmoji: string,
): string {
  if (summary.totals.configuredPlatforms === 0) {
    return `📣 Marketing today — ${postureEmoji} no ad platforms configured`;
  }
  if (summary.totals.activeCampaigns === 0) {
    return `📣 Marketing today — ${postureEmoji} 0 active campaigns`;
  }
  return `📣 Marketing today — ${postureEmoji} $${summary.totals.spend30d.toFixed(2)} spend · ${summary.totals.roas30d.toFixed(2)}x ROAS · ${summary.totals.activeCampaigns} active`;
}

function buildBriefText(s: MarketingTodaySummary): string {
  const parts: string[] = [];
  if (s.posture === "red") {
    if (s.oldestPendingApprovals.some((a) => a.ageDays >= 3)) {
      parts.push(
        "*🚨 Stale approval (≥3 days old).* Decide or stand it down.",
      );
    }
    const errBlockers = s.blockers.filter(
      (b) => !/no active campaigns/.test(b.reason),
    );
    if (errBlockers.length > 0) {
      parts.push(
        `*🚨 ${errBlockers.length} platform fetch error${errBlockers.length === 1 ? "" : "s"}.* Silent failures hide spend issues — check API keys / rate limits.`,
      );
    }
  }
  if (s.totals.configuredPlatforms === 0) {
    parts.push(
      "_No ad platforms configured. Set `META_ACCESS_TOKEN`, `GOOGLE_ADS_*`, or `TIKTOK_*` env vars to enable._",
    );
  }
  if (
    s.totals.configuredPlatforms > 0 &&
    s.totals.activeCampaigns === 0 &&
    s.posture !== "red"
  ) {
    parts.push(
      "_Configured platforms have zero active campaigns right now._",
    );
  }
  if (s.totals.activeCampaigns > 0 && s.totals.spend30d > 0) {
    const roasNote =
      s.totals.roas30d >= 1
        ? `*ROAS ${s.totals.roas30d.toFixed(2)}x* (revenue ≥ spend).`
        : `*ROAS ${s.totals.roas30d.toFixed(2)}x* — spend is exceeding tracked revenue.`;
    parts.push(roasNote);
  }
  if (s.pendingApprovals > 0) {
    parts.push(
      `*${s.pendingApprovals} pending marketing approval${s.pendingApprovals === 1 ? "" : "s"}* — open <${DASHBOARD_URL}|marketing dashboard> to review.`,
    );
  }
  if (parts.length === 0) {
    return "_Clean marketing posture._";
  }
  return parts.join(" ");
}

function formatPlatformRow(p: MarketingPlatformSummary): string {
  const statusIcon = platformStatusIcon(p.status);
  if (p.status === "not_configured") {
    return `• ${statusIcon} \`${p.platform}\` — _not configured_`;
  }
  if (p.status === "error") {
    return `• ${statusIcon} \`${p.platform}\` — error: ${truncate(p.fetchError ?? "", 60)}`;
  }
  if (p.status === "configured_no_campaigns") {
    return `• ${statusIcon} \`${p.platform}\` — configured but 0 active campaigns`;
  }
  return `• ${statusIcon} \`${p.platform}\` — $${p.spend30d.toFixed(2)} spend · ${p.roas30d.toFixed(2)}x ROAS · ${p.activeCampaignCount} active`;
}

function platformStatusIcon(s: MarketingPlatformStatus): string {
  switch (s) {
    case "active":
      return "🟢";
    case "configured_no_campaigns":
      return "🟡";
    case "error":
      return "🔴";
    case "not_configured":
      return "⚪️";
  }
}

function postureLabel(p: MarketingTodaySummary["posture"]): string {
  if (p === "green") return "🟢 clean";
  if (p === "yellow") return "🟡 work waiting";
  return "🔴 blocker";
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

// keep MarketingPlatformId in the export surface for callers that
// rebuild summaries — silenced in this file but referenced via type.
export type { MarketingPlatformId };
