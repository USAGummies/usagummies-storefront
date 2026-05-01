import {
  buildHeartbeatContext,
  completeHeartbeatRun,
  heartbeatIdempotencyKey,
  type AgentHeartbeatContract,
  type AgentHeartbeatRunRecord,
  type HeartbeatOutputState,
} from "@/lib/ops/agent-heartbeat";
import type { EmailAgentsStatus } from "@/lib/ops/email-agents-status";

export const EMAIL_AGENTS_READINESS_CONTRACT: AgentHeartbeatContract = {
  agentId: "email-agents-readiness",
  division: "platform-data-automation",
  owner: "Ben",
  queue: {
    source: "email-agents:readiness-gates",
    description:
      "Read-only gate review over the email-agent proposal, incident checklist, HubSpot schema, kill switch, and cron state.",
  },
  cadence: { type: "manual" },
  allowedApprovalSlugs: ["gmail.send", "hubspot.task.create", "lead.enrichment.write"],
  prohibitedActions: [
    "gmail.send.direct",
    "email-intel.runner.direct",
    "hubspot.deal.stage.move.direct",
    "qbo.bill.create",
    "shopify.price.update",
  ],
  memoryReads: [
    "contracts/email-agents-system-proposal.md",
    "contracts/email-agents-hubspot-property-spec.md",
    "contracts/incident-2026-04-30-email-intel.md",
    "contracts/agent-heartbeat.md",
  ],
  memoryWrites: [],
  budget: { monthlyUsdLimit: 10, maxRunsPerDay: 3 },
  escalation: "/ops/email-agents + #ops-approvals",
};

export interface EmailAgentsHeartbeatSummary {
  readiness: EmailAgentsStatus["readiness"];
  enabled: boolean;
  cronConfigured: boolean;
  blockers: string[];
  gatesPassed: number;
  gatesTotal: number;
  recommendedHumanAction: string | null;
  outputState: HeartbeatOutputState;
  summary: string;
}

export interface EmailAgentsHeartbeatResult {
  runRecord: AgentHeartbeatRunRecord;
  summary: EmailAgentsHeartbeatSummary;
}

export function summarizeEmailAgentsHeartbeat(
  status: EmailAgentsStatus,
): EmailAgentsHeartbeatSummary {
  const gatesPassed = status.gates.filter((gate) => gate.ok).length;
  const gatesTotal = status.gates.length;
  const outputState = outputStateForReadiness(status.readiness);
  const recommendedHumanAction = status.nextSafeAction.trim() || null;
  const blockerSuffix =
    status.blockers.length > 0
      ? ` Blockers: ${status.blockers.slice(0, 3).join("; ")}.`
      : "";
  const summary =
    status.readiness === "ready_for_dry_run"
      ? `Email agents are ready for one explicit dry-run (${gatesPassed}/${gatesTotal} gates passed).`
      : status.readiness === "active"
        ? `Email agents are active (${gatesPassed}/${gatesTotal} gates passed); monitor every run.`
        : status.readiness === "misconfigured"
          ? `Email agents are misconfigured (${gatesPassed}/${gatesTotal} gates passed).${blockerSuffix}`
          : `Email agents remain blocked (${gatesPassed}/${gatesTotal} gates passed).${blockerSuffix}`;

  return {
    readiness: status.readiness,
    enabled: status.enabled,
    cronConfigured: status.cronConfigured,
    blockers: [...status.blockers],
    gatesPassed,
    gatesTotal,
    recommendedHumanAction,
    outputState,
    summary,
  };
}

export function buildEmailAgentsHeartbeatRun(input: {
  now: Date;
  finishedAt?: Date;
  runId: string;
  status: EmailAgentsStatus;
}): EmailAgentsHeartbeatResult {
  const summary = summarizeEmailAgentsHeartbeat(input.status);
  const context = buildHeartbeatContext({
    now: input.now,
    runId: input.runId,
    contract: EMAIL_AGENTS_READINESS_CONTRACT,
    claim: {
      queueItemId: "email-agents-readiness-gates",
      idempotencyKey: heartbeatIdempotencyKey({
        agentId: EMAIL_AGENTS_READINESS_CONTRACT.agentId,
        queueSource: EMAIL_AGENTS_READINESS_CONTRACT.queue.source,
        queueItemId: input.now.toISOString().slice(0, 10),
      }),
    },
    doctrineRefs: [
      "contracts/agent-heartbeat.md",
      "contracts/email-agents-system-proposal.md",
      "contracts/incident-2026-04-30-email-intel.md",
    ],
    degradedSources:
      input.status.readiness === "misconfigured" ? input.status.blockers : [],
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

function outputStateForReadiness(
  readiness: EmailAgentsStatus["readiness"],
): HeartbeatOutputState {
  switch (readiness) {
    case "blocked":
      return "blocked_missing_data";
    case "ready_for_dry_run":
      return "no_action";
    case "active":
      return "no_action";
    case "misconfigured":
      return "failed_degraded";
  }
}
