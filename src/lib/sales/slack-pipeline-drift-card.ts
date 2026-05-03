/**
 * Slack Block Kit renderer for the `pipeline drift` command.
 *
 * Pure module — takes a precomputed drift summary + the per-deal
 * drift envelopes and renders the doctrine-compliant Block Kit card
 * (per /contracts/slack-card-doctrine.md):
 *   1. Header + posture chip
 *   2. 6-field stats grid (drifted total / clean / 1-step / 2-step /
 *      3+-step / no-evidence)
 *   3. Brief block ("what this means")
 *   4. Top 5 most-drifted rows
 *   5. Context block (read-only note + degraded)
 *   6. Open dashboard action
 */
import type { PipelineDrift } from "./pipeline-verifier";
import {
  PIPELINE_STAGE_LABELS,
  type PipelineStage,
} from "./pipeline-evidence";

const DASHBOARD_URL = "https://www.usagummies.com/ops/sales/pipeline-drift";

export interface PipelineDriftSummary {
  total: number;
  clean: number;
  driftCount: number;
  bySeverity: {
    oneStep: number;
    twoStep: number;
    threePlusStep: number;
    noEvidence: number;
  };
}

export interface SlackPipelineDriftCard {
  text: string;
  blocks: unknown[];
}

export function renderPipelineDriftCard(args: {
  summary: PipelineDriftSummary;
  drifted: ReadonlyArray<PipelineDrift & { dealName?: string }>;
  degraded?: ReadonlyArray<string>;
  generatedAt?: string;
}): SlackPipelineDriftCard {
  const { summary, drifted } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const posture = derivePosture(summary);
  const postureChip = postureLabel(posture);

  const text =
    summary.driftCount === 0
      ? `🧭 Pipeline drift — ${postureChip} ${summary.total} deals clean`
      : `🧭 Pipeline drift — ${postureChip} ${summary.driftCount}/${summary.total} drifted`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🧭 Pipeline drift — ${postureChip}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total*\n${summary.total}` },
        { type: "mrkdwn", text: `*Clean*\n${summary.clean}` },
        {
          type: "mrkdwn",
          text: `*Drifted*\n${summary.driftCount}`,
        },
        {
          type: "mrkdwn",
          text: `*1-step ahead*\n${summary.bySeverity.oneStep}`,
        },
        {
          type: "mrkdwn",
          text: `*2-step ahead*\n${summary.bySeverity.twoStep}`,
        },
        {
          type: "mrkdwn",
          text: `*3+ / no-evidence*\n${summary.bySeverity.threePlusStep + summary.bySeverity.noEvidence}`,
        },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: buildBriefText(summary) },
    },
  ];

  if (drifted.length > 0) {
    const sorted = [...drifted].sort((a, b) => {
      // No-evidence sorts first, then by driftSteps desc.
      const aNoEv = a.verifiedStage === null ? 1 : 0;
      const bNoEv = b.verifiedStage === null ? 1 : 0;
      if (aNoEv !== bNoEv) return bNoEv - aNoEv;
      return b.driftSteps - a.driftSteps;
    });
    const top = sorted.slice(0, 5);
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Top ${top.length} drifted deals*\n` +
          top.map(formatDriftRow).join("\n"),
      },
    });
  }

  const contextLines: string[] = [
    `Generated ${formatShortTime(generatedAt)} · Read-only — no HubSpot stage is moved from this card`,
  ];
  if (args.degraded && args.degraded.length > 0) {
    contextLines.push(
      `:warning: Degraded: ${args.degraded.slice(0, 3).join(" · ")}`,
    );
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
          text: "Open drift dashboard",
          emoji: true,
        },
        url: DASHBOARD_URL,
        action_id: "open_pipeline_drift",
      },
    ],
  });

  return { text, blocks };
}

function derivePosture(s: PipelineDriftSummary): "green" | "yellow" | "red" {
  if (s.bySeverity.threePlusStep > 0 || s.bySeverity.noEvidence > 0) {
    return "red";
  }
  if (s.driftCount > 0) return "yellow";
  return "green";
}

function postureLabel(p: "green" | "yellow" | "red"): string {
  if (p === "green") return "🟢 clean";
  if (p === "yellow") return "🟡 work waiting";
  return "🔴 attention";
}

function buildBriefText(s: PipelineDriftSummary): string {
  if (s.driftCount === 0) {
    return "_All HubSpot stages match the verified evidence trail. No drift._";
  }
  const parts: string[] = [];
  if (s.bySeverity.noEvidence > 0) {
    parts.push(
      `*🚨 ${s.bySeverity.noEvidence} deal${s.bySeverity.noEvidence === 1 ? "" : "s"}* claim a stage with ZERO evidence on file.`,
    );
  }
  if (s.bySeverity.threePlusStep > 0) {
    parts.push(
      `*🚨 ${s.bySeverity.threePlusStep} deal${s.bySeverity.threePlusStep === 1 ? "" : "s"}* run ≥ 3 stages ahead of evidence.`,
    );
  }
  if (s.bySeverity.twoStep > 0 || s.bySeverity.oneStep > 0) {
    parts.push(
      `${s.bySeverity.twoStep + s.bySeverity.oneStep} deal${(s.bySeverity.twoStep + s.bySeverity.oneStep) === 1 ? "" : "s"} are 1-2 stages ahead — verify or downgrade.`,
    );
  }
  parts.push("_Open the dashboard to drill into evidence trails._");
  return parts.join(" ");
}

function formatDriftRow(
  d: PipelineDrift & { dealName?: string },
): string {
  const name = d.dealName ? truncate(d.dealName, 40) : `\`${d.dealId.slice(0, 14)}\``;
  const verifiedLabel = d.verifiedStage
    ? PIPELINE_STAGE_LABELS[d.verifiedStage]
    : "(no evidence)";
  const claimedLabel = PIPELINE_STAGE_LABELS[d.hubspotStage];
  const stepsLabel =
    d.verifiedStage === null ? "no-evidence" : `+${d.driftSteps}`;
  return `• ${name} — _${verifiedLabel}_ → \`${claimedLabel}\` (${stepsLabel})`;
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

// Re-export for callers that need the type
export type { PipelineStage };
