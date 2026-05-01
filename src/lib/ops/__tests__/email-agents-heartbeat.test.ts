import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMAIL_AGENTS_READINESS_CONTRACT,
  buildEmailAgentsHeartbeatRun,
  summarizeEmailAgentsHeartbeat,
} from "../email-agents-heartbeat";
import type { EmailAgentsStatus } from "../email-agents-status";

const BASE_STATUS: EmailAgentsStatus = {
  generatedAt: "2026-04-30T20:00:00.000Z",
  readiness: "blocked",
  enabled: false,
  cronConfigured: false,
  hubspotSchemaReady: true,
  gates: [
    { id: "classifier_fix", label: "Classifier", ok: true, source: "doc", detail: "ok" },
    { id: "approval_gate_audit", label: "Approval gate", ok: false, source: "doc", detail: "pending" },
  ],
  blockers: ["Approval gate: pending"],
  nextSafeAction: "Do not run email-intel.",
  sourceDocs: ["contracts/incident-2026-04-30-email-intel.md"],
};

function status(overrides: Partial<EmailAgentsStatus>): EmailAgentsStatus {
  return { ...BASE_STATUS, ...overrides };
}

describe("email agents heartbeat", () => {
  it("uses a manual readiness contract and never permits direct runner execution", () => {
    expect(EMAIL_AGENTS_READINESS_CONTRACT.agentId).toBe("email-agents-readiness");
    expect(EMAIL_AGENTS_READINESS_CONTRACT.cadence).toEqual({ type: "manual" });
    expect(EMAIL_AGENTS_READINESS_CONTRACT.allowedApprovalSlugs).toContain("gmail.send");
    expect(EMAIL_AGENTS_READINESS_CONTRACT.prohibitedActions).toContain(
      "email-intel.runner.direct",
    );
  });

  it("maps blocked readiness to blocked_missing_data with the blocker surfaced", () => {
    const summary = summarizeEmailAgentsHeartbeat(BASE_STATUS);
    expect(summary.outputState).toBe("blocked_missing_data");
    expect(summary.gatesPassed).toBe(1);
    expect(summary.gatesTotal).toBe(2);
    expect(summary.summary).toContain("Email agents remain blocked");
    expect(summary.summary).toContain("Approval gate");
    expect(summary.recommendedHumanAction).toBe("Do not run email-intel.");
  });

  it("maps ready_for_dry_run to a no_action heartbeat", () => {
    const summary = summarizeEmailAgentsHeartbeat(
      status({
        readiness: "ready_for_dry_run",
        blockers: [],
        nextSafeAction: "Run one explicit dry-run.",
        gates: BASE_STATUS.gates.map((gate) => ({ ...gate, ok: true })),
      }),
    );
    expect(summary.outputState).toBe("no_action");
    expect(summary.summary).toContain("ready for one explicit dry-run");
  });

  it("maps misconfigured readiness to failed_degraded", () => {
    const result = buildEmailAgentsHeartbeatRun({
      now: new Date("2026-04-30T20:00:00.000Z"),
      finishedAt: new Date("2026-04-30T20:00:03.000Z"),
      runId: "email-agents-1",
      status: status({
        readiness: "misconfigured",
        enabled: true,
        blockers: ["Runner enabled before approval-gate audit"],
        nextSafeAction: "Disable the runner.",
      }),
    });
    expect(result.runRecord.outputState).toBe("failed_degraded");
    expect(result.runRecord.degradedSources).toEqual([
      "Runner enabled before approval-gate audit",
    ]);
    expect(result.runRecord.nextHumanAction).toBe("Disable the runner.");
  });

  it("builds a canonical run record without approval requests", () => {
    const result = buildEmailAgentsHeartbeatRun({
      now: new Date("2026-04-30T20:00:00.000Z"),
      runId: "email-agents-1",
      status: BASE_STATUS,
    });
    expect(result.runRecord).toMatchObject({
      runId: "email-agents-1",
      agentId: "email-agents-readiness",
      division: "platform-data-automation",
      owner: "Ben",
      outputState: "blocked_missing_data",
      queueItemId: "email-agents-readiness-gates",
      approvalSlugsRequested: [],
    });
    expect(result.runRecord.idempotencyKey).toBe(
      "email-agents-readiness:email-agents-readiness-gates:2026-04-30",
    );
  });

  it("has no external side-effect imports", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/ops/email-agents-heartbeat.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/gmail/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/shopify\//);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/control-plane\/slack/);
    expect(source).not.toMatch(/\bfetch\(/);
  });
});
