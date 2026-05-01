import type { SalesCommandCenterReport } from "./sales-command-center";

export interface SlackCommandCenterMessage {
  text: string;
  blocks: unknown[];
}

function money(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "not wired";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function count(n: number | null): string {
  return n === null ? "not wired" : String(n);
}

function sourceStatusLabel(status: string): string {
  switch (status) {
    case "wired":
      return "ready";
    case "not_wired":
      return "not wired";
    case "error":
      return "error";
    default:
      return status;
  }
}

function ageLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "unknown age";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function topLine(report: SalesCommandCenterReport): string {
  const actions = report.todaysRevenueActions;
  const totalKnown =
    (actions.faireInvitesNeedsReview ?? 0) +
    (actions.faireFollowUpsActionable ?? 0) +
    (actions.pendingApprovals ?? 0) +
    (actions.retailDraftsNeedsReview ?? 0) +
    (actions.apPacketsActionRequired ?? 0) +
    (actions.staleBuyersNeedingFollowUp ?? 0);
  return totalKnown > 0
    ? `${totalKnown} known action${totalKnown === 1 ? "" : "s"} queued`
    : "No known actions queued";
}

export function renderSalesCommandCenterSlack(
  report: SalesCommandCenterReport,
): SlackCommandCenterMessage {
  const kpi = report.kpiScorecard;
  const actions = report.todaysRevenueActions;
  const aging = report.aging.counts;
  const blockers = report.blockers.notes.length + report.blockers.missingEnv.length;
  const text = `USA Gummies Command Center — ${topLine(report)}`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "USA Gummies Command Center", emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Generated ${report.generatedAt} · ${topLine(report)} · <https://www.usagummies.com/ops/sales|Open dashboard>`,
        },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Revenue last 7d*\n${money(kpi.actualLast7dUsd)}` },
        { type: "mrkdwn", text: `*Required / wk*\n${money(kpi.requiredWeeklyUsd)}` },
        { type: "mrkdwn", text: `*Gap to pace*\n${money(kpi.gapToWeeklyPaceUsd)}` },
        { type: "mrkdwn", text: `*Confidence*\n${kpi.confidence}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Approvals*\n${count(actions.pendingApprovals)}` },
        { type: "mrkdwn", text: `*Faire follow-ups*\n${count(actions.faireFollowUpsActionable)}` },
        { type: "mrkdwn", text: `*Faire invites*\n${count(actions.faireInvitesNeedsReview)}` },
        { type: "mrkdwn", text: `*Retail drafts*\n${count(actions.retailDraftsNeedsReview)}` },
        { type: "mrkdwn", text: `*AP packets*\n${count(actions.apPacketsActionRequired)}` },
        { type: "mrkdwn", text: `*Stale buyers*\n${count(actions.staleBuyersNeedingFollowUp)}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Aging risk*\n${aging.critical} critical · ${aging.overdue} overdue · ${aging.watch} watch` },
        { type: "mrkdwn", text: `*Blockers*\n${blockers}` },
        { type: "mrkdwn", text: `*Dispatch open*\n${report.dispatchSummary.openCount.status === "wired" ? report.dispatchSummary.openCount.value : sourceStatusLabel(report.dispatchSummary.openCount.status)}` },
        { type: "mrkdwn", text: `*Wholesale inquiries*\n${report.wholesaleOnboarding.inquiries.status === "wired" ? report.wholesaleOnboarding.inquiries.value.total : sourceStatusLabel(report.wholesaleOnboarding.inquiries.status)}` },
      ],
    },
  ];

  const callouts = report.aging.topItems.slice(0, 3);
  if (callouts.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Top aging risks*",
          ...callouts.map((item) => `• *${item.tier}* · ${item.label} · ${ageLabel(item.ageHours)}`),
        ].join("\n"),
      },
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        text: { type: "plain_text", text: "Open Sales Command", emoji: true },
        url: "https://www.usagummies.com/ops/sales",
        action_id: "open_ops_sales",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Approvals", emoji: true },
        url: "https://www.usagummies.com/ops/approvals",
        action_id: "open_ops_approvals",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Readiness", emoji: true },
        url: "https://www.usagummies.com/ops/readiness",
        action_id: "open_ops_readiness",
      },
    ],
  });

  return { text, blocks };
}
