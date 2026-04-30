import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HEARTBEAT_OUTPUT_STATES,
  buildHeartbeatContext,
  completeHeartbeatRun,
  heartbeatIdempotencyKey,
  isHeartbeatOutputState,
  type AgentHeartbeatContract,
} from "..";

const CONTRACT: AgentHeartbeatContract = {
  agentId: "b2b-revenue-watcher",
  division: "sales",
  owner: "Ben",
  queue: {
    source: "hubspot:b2b",
    description: "B2B buyer replies and stale deals",
  },
  cadence: { type: "cron", rrule: "FREQ=DAILY;BYHOUR=8" },
  allowedApprovalSlugs: ["gmail.send", "shipment.create"],
  prohibitedActions: ["qbo.bill.create", "shopify.price.update"],
  memoryReads: ["operating-memory:recent", "contracts:wholesale-pricing"],
  memoryWrites: ["operating-memory:decision"],
  budget: { monthlyUsdLimit: 25, maxRunsPerDay: 3 },
  escalation: "#ops-approvals",
};

describe("agent heartbeat primitives", () => {
  it("locks the allowed terminal output states", () => {
    expect(HEARTBEAT_OUTPUT_STATES).toEqual([
      "no_action",
      "drafted",
      "task_created",
      "approval_requested",
      "blocked_missing_data",
      "failed_degraded",
      "expired",
      "escalated",
    ]);
    expect(isHeartbeatOutputState("approval_requested")).toBe(true);
    expect(isHeartbeatOutputState("sent_email")).toBe(false);
  });

  it("builds a deterministic heartbeat context from caller-supplied time", () => {
    const context = buildHeartbeatContext({
      now: new Date("2026-04-30T12:00:00.000Z"),
      runId: "run-1",
      contract: CONTRACT,
      claim: {
        queueItemId: "deal-123",
        idempotencyKey: "b2b-revenue-watcher:hubspot-b2b:deal-123",
      },
      doctrineRefs: [" contracts/agent-heartbeat.md ", "contracts/agent-heartbeat.md"],
      degradedSources: ["", "hubspot tasks"],
    });

    expect(context.startedAt).toBe("2026-04-30T12:00:00.000Z");
    expect(context.doctrineRefs).toEqual(["contracts/agent-heartbeat.md"]);
    expect(context.degradedSources).toEqual(["hubspot tasks"]);
    expect(context.claim?.queueItemId).toBe("deal-123");
  });

  it("fails closed on missing required identity fields", () => {
    expect(() =>
      buildHeartbeatContext({
        now: new Date("2026-04-30T12:00:00.000Z"),
        runId: "run-1",
        contract: { ...CONTRACT, agentId: " " },
      }),
    ).toThrow("heartbeat_contract_invalid:agentId");
  });

  it("normalizes invalid budget numerics to null instead of fabricating", () => {
    const context = buildHeartbeatContext({
      now: new Date("2026-04-30T12:00:00.000Z"),
      runId: "run-1",
      contract: {
        ...CONTRACT,
        budget: { monthlyUsdLimit: Number.NaN, maxRunsPerDay: -1 },
      },
    });
    expect(context.contract.budget).toEqual({
      monthlyUsdLimit: null,
      maxRunsPerDay: null,
    });
  });

  it("derives stable idempotency keys from agent, source, and queue item", () => {
    expect(
      heartbeatIdempotencyKey({
        agentId: "B2B Revenue Watcher",
        queueSource: "HubSpot B2B",
        queueItemId: "Deal 123",
      }),
    ).toBe("b2b-revenue-watcher:hubspot-b2b:deal-123");
  });

  it("completes a run record without executing any action", () => {
    const context = buildHeartbeatContext({
      now: new Date("2026-04-30T12:00:00.000Z"),
      runId: "run-1",
      contract: CONTRACT,
    });
    const record = completeHeartbeatRun({
      context,
      finishedAt: new Date("2026-04-30T12:01:00.000Z"),
      outputState: "approval_requested",
      approvalSlugsRequested: ["gmail.send", "gmail.send"],
      summary: "Drafted one buyer reply for approval.",
      nextHumanAction: "Review Slack approval.",
    });

    expect(record).toMatchObject({
      runId: "run-1",
      agentId: "b2b-revenue-watcher",
      outputState: "approval_requested",
      approvalSlugsRequested: ["gmail.send"],
      nextHumanAction: "Review Slack approval.",
    });
  });

  it("rejects unknown output states", () => {
    const context = buildHeartbeatContext({
      now: new Date("2026-04-30T12:00:00.000Z"),
      runId: "run-1",
      contract: CONTRACT,
    });
    expect(() =>
      completeHeartbeatRun({
        context,
        finishedAt: new Date("2026-04-30T12:01:00.000Z"),
        outputState: "sent_email",
        summary: "Bad state.",
      }),
    ).toThrow("heartbeat_output_state_invalid:sent_email");
  });

  it("rejects approval slugs outside the contract allowlist", () => {
    const context = buildHeartbeatContext({
      now: new Date("2026-04-30T12:00:00.000Z"),
      runId: "run-1",
      contract: CONTRACT,
    });
    expect(() =>
      completeHeartbeatRun({
        context,
        finishedAt: new Date("2026-04-30T12:01:00.000Z"),
        outputState: "approval_requested",
        approvalSlugsRequested: ["qbo.bill.create"],
        summary: "Bad approval.",
      }),
    ).toThrow("heartbeat_approval_slug_not_allowed:qbo.bill.create");
  });

  it("has no external side-effect imports", () => {
    const dir = join(process.cwd(), "src/lib/ops/agent-heartbeat");
    const source = [
      "types.ts",
      "context.ts",
      "run-record.ts",
      "index.ts",
    ]
      .map((file) => readFileSync(join(dir, file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/@vercel\/kv|gmail|hubspot|qbo|shopify|slack|fetch\(/i);
  });
});
