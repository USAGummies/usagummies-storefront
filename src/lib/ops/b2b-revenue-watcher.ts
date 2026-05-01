import {
  buildHeartbeatContext,
  completeHeartbeatRun,
  heartbeatIdempotencyKey,
  type AgentHeartbeatContract,
  type AgentHeartbeatRunRecord,
  type HeartbeatOutputState,
} from "@/lib/ops/agent-heartbeat";
import type { SourceState } from "@/lib/ops/sales-command-center";
import type {
  StaleBuyerClassification,
  StaleBuyerSummary,
} from "@/lib/sales/stale-buyer";

export const B2B_REVENUE_WATCHER_CONTRACT: AgentHeartbeatContract = {
  agentId: "b2b-revenue-watcher",
  division: "sales",
  owner: "Ben",
  queue: {
    source: "sales-command:b2b-revenue",
    description:
      "Read-only B2B revenue queues: stale buyers, Faire follow-ups, pending approvals, and wholesale inquiries.",
  },
  cadence: {
    type: "cron",
    rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=45;BYSECOND=0",
  },
  allowedApprovalSlugs: [
    "gmail.send",
    "faire-direct.invite",
    "faire-direct.follow-up",
    "receipt.review.promote",
  ],
  prohibitedActions: [
    "gmail.send.direct",
    "hubspot.deal.stage.move.direct",
    "qbo.bill.create",
    "shopify.price.update",
    "faire.api.invite.send",
  ],
  memoryReads: [
    "contracts/openai-workspace-agents.md",
    "contracts/agent-heartbeat.md",
    "contracts/workflow-blueprint.md",
  ],
  memoryWrites: [],
  budget: { monthlyUsdLimit: 25, maxRunsPerDay: 4 },
  escalation: "#sales / #ops-approvals",
};

export interface B2BRevenueWatcherInput {
  staleBuyers: SourceState<StaleBuyerSummary>;
  faireFollowUps: SourceState<{ overdue: number; dueSoon: number }>;
  pendingApprovals: SourceState<{ total: number }>;
  wholesaleInquiries: SourceState<{ total: number; lastSubmittedAt?: string }>;
}

export interface B2BRevenueWatcherStaleBuyerAction {
  dealId: string;
  dealName: string;
  stageName: string;
  daysSinceActivity: number | null;
  thresholdDays: number;
  nextAction: string;
  primaryCompanyName: string | null;
}

export interface B2BRevenueWatcherSummary {
  staleBuyers: number | null;
  topStaleBuyers: B2BRevenueWatcherStaleBuyerAction[];
  faireFollowUpsDue: number | null;
  pendingApprovals: number | null;
  wholesaleInquiries: number | null;
  degradedSources: string[];
  recommendedHumanAction: string | null;
  outputState: HeartbeatOutputState;
  summary: string;
}

export interface B2BRevenueWatcherResult {
  runRecord: AgentHeartbeatRunRecord;
  summary: B2BRevenueWatcherSummary;
}

export function summarizeB2BRevenueWatcherInput(
  input: B2BRevenueWatcherInput,
): B2BRevenueWatcherSummary {
  const staleBuyers = wiredOrNull(input.staleBuyers, (s) =>
    s.staleByStage.reduce((sum, row) => sum + row.count, 0),
  );
  const topStaleBuyers =
    input.staleBuyers.status === "wired"
      ? selectTopStaleBuyerActions(input.staleBuyers.value)
      : [];
  const faireFollowUpsDue = wiredOrNull(
    input.faireFollowUps,
    (s) => s.overdue + s.dueSoon,
  );
  const pendingApprovals = wiredOrNull(input.pendingApprovals, (s) => s.total);
  const wholesaleInquiries = wiredOrNull(input.wholesaleInquiries, (s) => s.total);

  const degradedSources = [
    degradedReason("staleBuyers", input.staleBuyers),
    degradedReason("faireFollowUps", input.faireFollowUps),
    degradedReason("pendingApprovals", input.pendingApprovals),
    degradedReason("wholesaleInquiries", input.wholesaleInquiries),
  ].filter((reason): reason is string => reason !== null);

  const actions = [
    staleBuyers ? `${staleBuyers} stale B2B buyer(s)` : null,
    faireFollowUpsDue ? `${faireFollowUpsDue} Faire follow-up(s) due` : null,
    pendingApprovals ? `${pendingApprovals} approval(s) awaiting Ben` : null,
  ].filter((item): item is string => item !== null);

  const firstStaleBuyer = topStaleBuyers[0] ?? null;
  const staleBuyerAction = firstStaleBuyer
    ? `Start with ${firstStaleBuyer.dealName} (${firstStaleBuyer.stageName}, ${formatDaysSinceActivity(firstStaleBuyer.daysSinceActivity)}): ${firstStaleBuyer.nextAction}.`
    : null;

  const outputState: HeartbeatOutputState =
    degradedSources.length > 0
      ? "failed_degraded"
      : actions.length > 0
        ? "task_created"
        : "no_action";

  const recommendedHumanAction =
    staleBuyerAction
      ? `${staleBuyerAction} Review ${actions.join(" · ")} in /ops/sales.`
      : actions.length > 0
        ? `Review ${actions.join(" · ")} in /ops/sales.`
        : degradedSources.length > 0
          ? "Open /ops/readiness and fix degraded B2B revenue sources."
          : null;

  const staleBuyerPreview =
    topStaleBuyers.length > 0
      ? ` Top stale buyer: ${topStaleBuyers[0].dealName} (${topStaleBuyers[0].stageName}, ${formatDaysSinceActivity(topStaleBuyers[0].daysSinceActivity)}).`
      : "";

  const summary =
    actions.length > 0
      ? `B2B Revenue Watcher found ${actions.join(", ")}.${staleBuyerPreview}`
      : degradedSources.length > 0
        ? `B2B Revenue Watcher degraded: ${degradedSources.join("; ")}.`
        : "B2B Revenue Watcher found no queued revenue actions.";

  return {
    staleBuyers,
    topStaleBuyers,
    faireFollowUpsDue,
    pendingApprovals,
    wholesaleInquiries,
    degradedSources,
    recommendedHumanAction,
    outputState,
    summary,
  };
}

export function selectTopStaleBuyerActions(
  summary: StaleBuyerSummary,
  limit = 3,
): B2BRevenueWatcherStaleBuyerAction[] {
  return summary.stalest
    .filter((buyer) => buyer.isStale)
    .slice(0, Math.max(0, limit))
    .map(toStaleBuyerAction);
}

export function buildB2BRevenueWatcherRun(input: {
  now: Date;
  finishedAt?: Date;
  runId: string;
  sources: B2BRevenueWatcherInput;
}): B2BRevenueWatcherResult {
  const summary = summarizeB2BRevenueWatcherInput(input.sources);
  const context = buildHeartbeatContext({
    now: input.now,
    runId: input.runId,
    contract: B2B_REVENUE_WATCHER_CONTRACT,
    claim: {
      queueItemId: "b2b-revenue-daily-scan",
      idempotencyKey: heartbeatIdempotencyKey({
        agentId: B2B_REVENUE_WATCHER_CONTRACT.agentId,
        queueSource: B2B_REVENUE_WATCHER_CONTRACT.queue.source,
        queueItemId: input.now.toISOString().slice(0, 10),
      }),
    },
    doctrineRefs: [
      "contracts/agent-heartbeat.md",
      "contracts/openai-workspace-agents.md",
      "contracts/workflow-blueprint.md",
    ],
    degradedSources: summary.degradedSources,
  });
  const runRecord = completeHeartbeatRun({
    context,
    finishedAt: input.finishedAt ?? input.now,
    outputState: summary.outputState,
    summary: summary.summary,
    nextHumanAction: summary.recommendedHumanAction,
  });
  return { runRecord, summary };
}

function wiredOrNull<T, R>(state: SourceState<T>, pick: (value: T) => R): R | null {
  return state.status === "wired" ? pick(state.value) : null;
}

function degradedReason<T>(name: string, state: SourceState<T>): string | null {
  if (state.status === "wired") return null;
  return `${name}: ${state.reason}`;
}

function toStaleBuyerAction(
  buyer: StaleBuyerClassification,
): B2BRevenueWatcherStaleBuyerAction {
  return {
    dealId: buyer.dealId,
    dealName: buyer.dealName,
    stageName: buyer.stageName,
    daysSinceActivity: Number.isFinite(buyer.daysSinceActivity)
      ? buyer.daysSinceActivity
      : null,
    thresholdDays: buyer.thresholdDays,
    nextAction: buyer.nextAction,
    primaryCompanyName: buyer.primaryCompanyName,
  };
}

function formatDaysSinceActivity(days: number | null): string {
  return days === null ? "no activity timestamp" : `${days}d stale`;
}
