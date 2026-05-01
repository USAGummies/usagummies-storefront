export type EmailAgentsReadiness =
  | "blocked"
  | "ready_for_dry_run"
  | "active"
  | "misconfigured";

export interface EmailAgentsGate {
  id: string;
  label: string;
  ok: boolean;
  source: string;
  detail: string;
}

export interface EmailAgentsStatusInput {
  incidentMarkdown: string;
  systemMarkdown: string;
  hubspotPropertyMarkdown: string;
  vercelJson: string;
  env: Record<string, string | undefined>;
}

export interface EmailAgentsStatus {
  generatedAt: string;
  readiness: EmailAgentsReadiness;
  enabled: boolean;
  cronConfigured: boolean;
  hubspotSchemaReady: boolean;
  gates: EmailAgentsGate[];
  blockers: string[];
  nextSafeAction: string;
  sourceDocs: string[];
}

export function deriveEmailAgentsStatus(
  input: EmailAgentsStatusInput,
  options: { now?: Date } = {},
): EmailAgentsStatus {
  const enabled = isTruthy(input.env.EMAIL_INTEL_ENABLED);
  const cronConfigured = /\/api\/ops\/fulfillment\/email-intel\/run/.test(
    input.vercelJson,
  );
  const classifierFixed = hasCheckedLine(
    input.incidentMarkdown,
    "Classifier fix shipped",
  );
  const templateAuditComplete = hasCheckedLine(
    input.incidentMarkdown,
    "Template audit complete",
  );
  const approvalGateAuditComplete = hasCheckedLine(
    input.incidentMarkdown,
    "Approval-gate audit complete",
  );
  const hubspotSchemaReady =
    /Status of gate:\*\*\s*✅\s*UNBLOCKED/i.test(
      input.hubspotPropertyMarkdown,
    ) || /Schema status[^]*?✅[^]*?properties/i.test(input.systemMarkdown);

  const gates: EmailAgentsGate[] = [
    {
      id: "classifier_fix",
      label: "Classifier regression fixed",
      ok: classifierFixed,
      source: "contracts/incident-2026-04-30-email-intel.md",
      detail: classifierFixed
        ? "Incident checklist marks the classifier fix shipped/tested."
        : "Incident checklist has not marked the classifier fix complete.",
    },
    {
      id: "template_audit",
      label: "Template audit complete",
      ok: templateAuditComplete,
      source: "contracts/incident-2026-04-30-email-intel.md",
      detail: templateAuditComplete
        ? "Incident checklist marks all email templates audited."
        : "Incident checklist has not marked the template audit complete.",
    },
    {
      id: "approval_gate_audit",
      label: "Approval-gate audit complete",
      ok: approvalGateAuditComplete,
      source: "contracts/incident-2026-04-30-email-intel.md",
      detail: approvalGateAuditComplete
        ? "Ben has confirmed the approval-chain behavior from the incident."
        : "Still waiting on Ben's approval-gate confirmation from the incident.",
    },
    {
      id: "hubspot_schema",
      label: "HubSpot email-agent schema ready",
      ok: hubspotSchemaReady,
      source: "contracts/email-agents-hubspot-property-spec.md",
      detail: hubspotSchemaReady
        ? "HubSpot property gate is documented as unblocked."
        : "HubSpot property gate is not documented as unblocked.",
    },
    {
      id: "kill_switch_default_off",
      label: "Email-intel kill switch remains off",
      ok: !enabled,
      source: "EMAIL_INTEL_ENABLED",
      detail: enabled
        ? "EMAIL_INTEL_ENABLED is truthy; runner can execute."
        : "EMAIL_INTEL_ENABLED is absent/false; runner stays paused.",
    },
    {
      id: "cron_removed",
      label: "Email-intel cron remains removed",
      ok: !cronConfigured,
      source: "vercel.json",
      detail: cronConfigured
        ? "vercel.json contains the email-intel run path."
        : "vercel.json does not schedule the email-intel runner.",
    },
  ];

  const blockers = gates
    .filter((gate) => !gate.ok)
    .map((gate) => `${gate.label}: ${gate.detail}`);

  const doctrineReady =
    classifierFixed &&
    templateAuditComplete &&
    approvalGateAuditComplete &&
    hubspotSchemaReady;
  const readiness: EmailAgentsReadiness = enabled
    ? doctrineReady && cronConfigured
      ? "active"
      : "misconfigured"
    : doctrineReady
      ? "ready_for_dry_run"
      : "blocked";

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    readiness,
    enabled,
    cronConfigured,
    hubspotSchemaReady,
    gates,
    blockers,
    nextSafeAction: nextSafeAction(readiness),
    sourceDocs: [
      "contracts/email-agents-system.md",
      "contracts/email-agents-hubspot-property-spec.md",
      "contracts/incident-2026-04-30-email-intel.md",
      "vercel.json",
    ],
  };
}

export function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}

function hasCheckedLine(markdown: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`- \\[x\\][^\\n]*${escaped}`, "i").test(markdown);
}

function nextSafeAction(readiness: EmailAgentsReadiness): string {
  switch (readiness) {
    case "blocked":
      return "Do not run email-intel. Clear the unchecked incident/schema gates first.";
    case "ready_for_dry_run":
      return "Run one explicit dry-run and inspect output before any cron or kill-switch change.";
    case "misconfigured":
      return "Disable the runner or complete the doctrine gates before allowing it to run.";
    case "active":
      return "Monitor approvals, sent-mail audit, and incident regressions every run.";
  }
}
